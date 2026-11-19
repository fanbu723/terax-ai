//! SSH remote workspaces: host records, the system OpenSSH transport and the
//! remote filesystem the SSH execution world exposes.
//!
//! The Harness runs on this machine; a remote workspace moves the files and
//! processes to one SSH host. Authentication, `known_hosts`, `ProxyJump` and
//! `~/.ssh/config` stay with the OpenSSH client, so Terax stores no secret and
//! reimplements no crypto. Every remote operation fails closed: a path is only
//! served after its root was authorized for that host, and commands with no
//! remote implementation report [`crate::modules::workspace::remote_unsupported`]
//! instead of touching the local disk.

pub mod encoding;
pub mod exec;
pub mod fs;
pub mod hosts;
pub mod paths;
pub mod route;
pub mod scripts;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::Duration;

use serde::Serialize;

use self::hosts::{SshHost, SshHostInput};
use crate::modules::proc::capture::Limits;
use crate::modules::workspace::{remote_unsupported, validate_remote_path, WorkspaceEnv};

/// Probe result vocabulary shared with the frontend.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProbeResult {
    pub ok: bool,
    pub kind: String,
    pub message: String,
    pub home: Option<String>,
}

impl SshProbeResult {
    fn ok(home: String) -> Self {
        Self {
            ok: true,
            kind: "ok".into(),
            message: format!("connected; remote home is {home}"),
            home: Some(home),
        }
    }

    fn failure(kind: &str, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            kind: kind.into(),
            message: message.into(),
            home: None,
        }
    }
}

/// Host records plus the remote roots each host may serve.
pub struct SshState {
    document: PathBuf,
    hosts: RwLock<Vec<SshHost>>,
    /// host id -> normalized remote roots the UI explicitly opened.
    roots: RwLock<HashMap<String, Vec<String>>>,
}

impl SshState {
    /// Load the host document from the app config directory.
    pub fn load(config_dir: &Path) -> Self {
        let document = hosts::document_path(config_dir);
        let (loaded, warning) = hosts::load(&document);
        if let Some(warning) = warning {
            log::warn!("ssh: {warning}");
        }
        Self {
            document,
            hosts: RwLock::new(loaded),
            roots: RwLock::new(HashMap::new()),
        }
    }

    /// Every configured host, in document order.
    pub fn hosts(&self) -> Vec<SshHost> {
        self.hosts.read().expect("ssh hosts poisoned").clone()
    }

    /// One host by id.
    pub fn host(&self, id: &str) -> Result<SshHost, String> {
        self.hosts
            .read()
            .expect("ssh hosts poisoned")
            .iter()
            .find(|host| host.id == id)
            .cloned()
            .ok_or_else(|| format!("unknown SSH host: {id}"))
    }

    fn persist(&self, next: Vec<SshHost>) -> Result<(), String> {
        hosts::save(&self.document, &next)?;
        *self.hosts.write().expect("ssh hosts poisoned") = next;
        Ok(())
    }

    /// Append a validated host record.
    pub fn add(&self, input: SshHostInput) -> Result<SshHost, String> {
        let host = input.into_host(hosts::new_id())?;
        let mut next = self.hosts();
        next.push(host.clone());
        self.persist(next)?;
        Ok(host)
    }

    /// Replace a host record by id.
    pub fn update(&self, updated: SshHost) -> Result<SshHost, String> {
        let updated = updated.normalized()?;
        let mut next = self.hosts();
        let slot = next
            .iter_mut()
            .find(|host| host.id == updated.id)
            .ok_or_else(|| format!("unknown SSH host: {}", updated.id))?;
        *slot = updated.clone();
        self.persist(next)?;
        Ok(updated)
    }

    /// Remove a host and every remote root authorized for it.
    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut next = self.hosts();
        let before = next.len();
        next.retain(|host| host.id != id);
        if next.len() == before {
            return Err(format!("unknown SSH host: {id}"));
        }
        self.persist(next)?;
        self.roots.write().expect("ssh roots poisoned").remove(id);
        Ok(())
    }

    /// Authorize one canonical remote root for a host.
    pub fn authorize_root(&self, host_id: &str, canonical: &str) {
        let mut roots = self.roots.write().expect("ssh roots poisoned");
        let entry = roots.entry(host_id.to_string()).or_default();
        if !entry.iter().any(|root| root == canonical) {
            entry.push(canonical.to_string());
        }
    }

    /// Normalize a remote path and require it to sit under an authorized root.
    pub fn require_authorized(&self, host_id: &str, path: &str) -> Result<String, String> {
        let normalized = paths::normalize_remote_path(path)?;
        let roots = self.roots.read().expect("ssh roots poisoned");
        let authorized = roots.get(host_id).is_some_and(|roots| {
            roots
                .iter()
                .any(|root| paths::remote_contains(root, &normalized))
        });
        if !authorized {
            return Err(format!(
                "remote path is outside the authorized SSH workspace: {normalized}"
            ));
        }
        Ok(normalized)
    }

    /// Resolve the host and normalized path for a remote workspace command.
    pub fn remote_context(
        &self,
        workspace: &WorkspaceEnv,
        path: &str,
    ) -> Result<(SshHost, String), String> {
        let host_id = workspace
            .ssh_host_id()
            .ok_or_else(|| "this command requires an SSH workspace".to_string())?;
        let host = self.host(host_id)?;
        let normalized = self.require_authorized(host_id, path)?;
        Ok((host, normalized))
    }
}

const PROBE_STDOUT: usize = 16 * 1024;

fn probe_limits() -> Limits {
    Limits {
        stdout: PROBE_STDOUT,
        stderr: PROBE_STDOUT,
        stop_on_stdout_cap: true,
    }
}

/// Run the probe script against one host without touching the state.
fn probe_host(host: &SshHost) -> SshProbeResult {
    let captured = match exec::run(
        host,
        &scripts::probe_home(),
        None,
        Duration::from_secs(15),
        probe_limits(),
    ) {
        Ok(captured) => captured,
        Err(error) => {
            let kind = if error.contains("OpenSSH client") || error.contains("was not found") {
                "missing-binary"
            } else {
                "failed"
            };
            return SshProbeResult::failure(kind, error);
        }
    };
    let stdout = String::from_utf8_lossy(&captured.stdout);
    let stderr = String::from_utf8_lossy(&captured.stderr);
    if captured.timed_out {
        return SshProbeResult::failure("unreachable", "the SSH connection timed out");
    }
    if captured.exit_code == Some(0) {
        let mut lines = stdout.lines();
        let header = lines.next().unwrap_or_default();
        if header == "TERAX_OK" {
            if let Some(home) = lines
                .next()
                .map(str::trim)
                .filter(|home| home.starts_with('/'))
            {
                return SshProbeResult::ok(home.to_string());
            }
        }
        if let Some(rest) = header.strip_prefix("TERAX_ERR\t") {
            let mut fields = rest.splitn(2, '\t');
            let code = fields.next().unwrap_or("IO");
            let encoded = fields.next().unwrap_or_default();
            let message = encoding::decode(encoded)
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
                .unwrap_or_else(|_| "the remote probe failed".to_string());
            if code == "MISSING" {
                return SshProbeResult::failure("failed", message);
            }
            return SshProbeResult::failure("failed", message);
        }
        return SshProbeResult::failure(
            "failed",
            format!("unexpected remote output: {}", stdout.trim()),
        );
    }
    let kind = exec::classify_failure(captured.exit_code, &stderr);
    let message = if stderr.trim().is_empty() {
        format!("SSH connection failed (exit {:?})", captured.exit_code)
    } else {
        stderr.trim().to_string()
    };
    SshProbeResult::failure(kind, message)
}

/// A host snapshot plus the roots authorized for it, copied out of the shared
/// state so a blocking command can use it without holding a Tauri `State`.
#[derive(Clone, Debug)]
pub struct RemoteRoots {
    pub host: SshHost,
    roots: Vec<String>,
}

impl RemoteRoots {
    /// Build a snapshot directly (integration tests and callers that already
    /// resolved the host themselves).
    pub fn new(host: SshHost, roots: Vec<String>) -> Self {
        Self { host, roots }
    }

    /// Normalize a remote path and require it to sit under an authorized root.
    pub fn normalize(&self, path: &str) -> Result<String, String> {
        let normalized = paths::normalize_remote_path(path)?;
        let authorized = self
            .roots
            .iter()
            .any(|root| paths::remote_contains(root, &normalized));
        if !authorized {
            return Err(format!(
                "remote path is outside the authorized SSH workspace: {normalized}"
            ));
        }
        Ok(normalized)
    }
}

impl SshState {
    /// Copy the host record and authorized roots for a remote workspace.
    pub fn snapshot(&self, workspace: &WorkspaceEnv) -> Result<RemoteRoots, String> {
        let host_id = workspace
            .ssh_host_id()
            .ok_or_else(|| "this command requires an SSH workspace".to_string())?;
        let host = self.host(host_id)?;
        let roots = self
            .roots
            .read()
            .expect("ssh roots poisoned")
            .get(host_id)
            .cloned()
            .unwrap_or_default();
        Ok(RemoteRoots { host, roots })
    }
}

#[tauri::command]
pub fn ssh_hosts_list(ssh: tauri::State<'_, SshState>) -> Vec<SshHost> {
    ssh.hosts()
}

#[tauri::command]
pub fn ssh_host_add(
    ssh: tauri::State<'_, SshState>,
    host: SshHostInput,
) -> Result<SshHost, String> {
    ssh.add(host)
}

#[tauri::command]
pub fn ssh_host_update(ssh: tauri::State<'_, SshState>, host: SshHost) -> Result<SshHost, String> {
    ssh.update(host)
}

#[tauri::command]
pub fn ssh_host_remove(ssh: tauri::State<'_, SshState>, id: String) -> Result<(), String> {
    ssh.remove(&id)
}

#[tauri::command]
pub async fn ssh_probe(
    ssh: tauri::State<'_, SshState>,
    id: String,
) -> Result<SshProbeResult, String> {
    let host = ssh.host(&id)?;
    let result = crate::modules::fs::blocking(move || Ok(probe_host(&host))).await?;
    if result.ok {
        if let Some(home) = &result.home {
            ssh.authorize_root(&id, home);
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn ssh_home(ssh: tauri::State<'_, SshState>, id: String) -> Result<String, String> {
    let host = ssh.host(&id)?;
    let home = crate::modules::fs::blocking(move || fs::home(&host)).await?;
    ssh.authorize_root(&id, &home);
    Ok(home)
}

#[tauri::command]
pub async fn ssh_authorize_root(
    ssh: tauri::State<'_, SshState>,
    id: String,
    path: String,
) -> Result<String, String> {
    validate_remote_path(&path)?;
    let host = ssh.host(&id)?;
    let canonical = crate::modules::fs::blocking(move || {
        let normalized = paths::normalize_remote_path(&path)?;
        fs::require_dir(&host, &normalized)?;
        fs::realpath(&host, &normalized)
    })
    .await?;
    ssh.authorize_root(&id, &canonical);
    Ok(canonical)
}

/// Snapshot the remote roots for a command, or `None` for a local workspace.
/// Built before the blocking pool so the pool never borrows Tauri state.
pub fn snapshot_if_remote(
    ssh: &SshState,
    workspace: Option<&WorkspaceEnv>,
) -> Result<Option<RemoteRoots>, String> {
    match workspace {
        Some(workspace) if workspace.is_remote() => ssh.snapshot(workspace).map(Some),
        _ => Ok(None),
    }
}

/// The remote context for a workspace-scoped command, or the fail-closed error
/// a host-only command returns.
pub fn context_for(
    ssh: &SshState,
    workspace: &WorkspaceEnv,
    path: &str,
    operation: &str,
) -> Result<(SshHost, String), String> {
    if !workspace.is_remote() {
        return Err(remote_unsupported(operation));
    }
    ssh.remote_context(workspace, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> (tempfile::TempDir, SshState) {
        let dir = tempfile::tempdir().unwrap();
        let state = SshState::load(dir.path());
        (dir, state)
    }

    fn host_input() -> SshHostInput {
        SshHostInput {
            label: "Box".into(),
            host: "dev.example".into(),
            ..Default::default()
        }
    }

    #[test]
    fn hosts_roundtrip_through_the_document() {
        let (_dir, state) = state();
        let added = state.add(host_input()).unwrap();
        assert_eq!(state.hosts().len(), 1);
        let mut updated = added.clone();
        updated.label = "Renamed".into();
        state.update(updated).unwrap();
        assert_eq!(state.host(&added.id).unwrap().label, "Renamed");
        state.remove(&added.id).unwrap();
        assert!(state.hosts().is_empty());
        assert!(state.remove(&added.id).is_err());
    }

    #[test]
    fn roots_gate_every_remote_path() {
        let (_dir, state) = host_state();
        state.authorize_root("ssh-1", "/home/me/project");
        assert!(state
            .require_authorized("ssh-1", "/home/me/project/a")
            .is_ok());
        assert!(state
            .require_authorized("ssh-1", "/home/me/project")
            .is_ok());
        assert!(state.require_authorized("ssh-1", "/home/me/other").is_err());
        assert!(state
            .require_authorized("ssh-1", "/home/me/project/../secret")
            .is_err());
        assert!(state
            .require_authorized("ssh-2", "/home/me/project/a")
            .is_err());
    }

    fn host_state() -> (tempfile::TempDir, SshState) {
        let (dir, state) = state();
        state.add(host_input()).unwrap();
        (dir, state)
    }

    #[test]
    fn remote_context_requires_an_ssh_workspace() {
        let (_dir, state) = host_state();
        let id = state.hosts()[0].id.clone();
        let local = WorkspaceEnv::Local;
        assert!(context_for(&state, &local, "/tmp", "fs_read_file").is_err());
        let remote = WorkspaceEnv::Ssh {
            host_id: id.clone(),
        };
        assert!(context_for(&state, &remote, "/tmp", "fs_read_file").is_err());
        state.authorize_root(&id, "/tmp");
        assert!(context_for(&state, &remote, "/tmp/x", "fs_read_file").is_ok());
    }
}
