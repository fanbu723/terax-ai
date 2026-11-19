//! Host records the SSH transport connects to.
//!
//! Authentication is OpenSSH's business: a record only names an existing
//! target (an alias from `~/.ssh/config` works), an optional port/user/identity
//! file and a preferred remote directory. No secret ever lands in this file.
//!
//! The document lives at `<app config dir>/ssh-hosts.json`, is written
//! atomically, and a document that cannot be parsed is set aside instead of
//! being silently overwritten.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::paths::normalize_remote_path;
use crate::modules::workspace::validate_remote_path;

/// One configured SSH destination, as the UI edits it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHost {
    /// Opaque stable id generated on add.
    pub id: String,
    /// Display name.
    pub label: String,
    /// Target without user: a hostname, an address or an `~/.ssh/config` alias.
    pub host: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    /// Absolute (or `~/`) path to a private key on the host running Terax.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
    /// Absolute remote directory a remote space opens in by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_dir: Option<String>,
    /// Absolute remote shell, e.g. `/bin/bash`; absent uses `$SHELL`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_shell: Option<String>,
}

/// The editable half of a host; the store assigns the id.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostInput {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub identity_file: Option<String>,
    #[serde(default)]
    pub default_dir: Option<String>,
    #[serde(default)]
    pub remote_shell: Option<String>,
}

impl SshHost {
    /// Validate and normalize this record. Returns a copy fit to persist.
    pub fn normalized(mut self) -> Result<Self, String> {
        self.label = require_text("host label", &self.label, 80)?;
        self.host = validate_target(&self.host)?;
        self.user = optional_text("ssh user", self.user.as_deref(), 64, |value| {
            value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
                && !value.starts_with('-')
        })?;
        if self.port == Some(0) {
            return Err("ssh port must be between 1 and 65535".into());
        }
        self.identity_file = optional_text(
            "identity file",
            self.identity_file.as_deref(),
            4096,
            |value| (value.starts_with('/') || value.starts_with("~/")) && !value.contains('\n'),
        )?;
        self.default_dir = self
            .default_dir
            .take()
            .map(|dir| normalize_remote_path(&dir))
            .transpose()?;
        self.remote_shell = optional_text(
            "remote shell",
            self.remote_shell.as_deref(),
            4096,
            |value| {
                value.starts_with('/')
                    && !value.contains('\n')
                    && !value.chars().any(|c| c == '\0' || c == '\r')
            },
        )?;
        Ok(self)
    }

    /// `user@host` or `host`, the argument the OpenSSH client expects.
    pub fn target(&self) -> String {
        match &self.user {
            Some(user) => format!("{user}@{}", self.host),
            None => self.host.clone(),
        }
    }
}

impl SshHostInput {
    /// Build a validated record under `id`.
    pub fn into_host(self, id: String) -> Result<SshHost, String> {
        SshHost {
            id,
            label: self.label,
            host: self.host,
            port: self.port,
            user: self.user,
            identity_file: self.identity_file,
            default_dir: self.default_dir,
            remote_shell: self.remote_shell,
        }
        .normalized()
    }
}

fn require_text(field: &str, value: &str, max: usize) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} is required"));
    }
    if trimmed.chars().count() > max {
        return Err(format!("{field} is too long"));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(format!("{field} contains control characters"));
    }
    Ok(trimmed.to_string())
}

fn optional_text(
    field: &str,
    value: Option<&str>,
    max: usize,
    accept: impl Fn(&str) -> bool,
) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.chars().count() > max {
        return Err(format!("{field} is too long"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{field} contains control characters"));
    }
    if !accept(value) {
        return Err(format!("{field} is not a valid value: {value}"));
    }
    Ok(Some(value.to_string()))
}

/// Validate a target: an alias, a hostname, an address, or a bracketed IPv6
/// literal. The user is a separate field so `@` is rejected to avoid two
/// competing spellings of the same thing.
fn validate_target(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("ssh host is required".into());
    }
    if trimmed.chars().count() > 255 {
        return Err("ssh host is too long".into());
    }
    if trimmed.contains('@') {
        return Err("put the user in the user field, not in the host".into());
    }
    if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("ssh host contains whitespace or control characters".into());
    }
    if trimmed.starts_with('-') {
        return Err("ssh host must not start with '-'".into());
    }
    let bracketed = trimmed.starts_with('[') && trimmed.ends_with(']');
    let body = if bracketed {
        &trimmed[1..trimmed.len().saturating_sub(1)]
    } else {
        trimmed
    };
    if body.is_empty() {
        return Err("ssh host is empty".into());
    }
    let valid = body
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':'));
    if !valid {
        return Err(format!("ssh host is not a valid target: {trimmed}"));
    }
    Ok(trimmed.to_string())
}

/// Where the host document lives inside the app config directory.
pub fn document_path(config_dir: &Path) -> PathBuf {
    config_dir.join("ssh-hosts.json")
}

/// Read the host document. A missing file is an empty list; an unreadable or
/// corrupted file is moved aside (`<name>.corrupt`) so the user can recover it
/// and the app can keep running with an empty list.
pub fn load(path: &Path) -> (Vec<SshHost>, Option<String>) {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return (Vec::new(), None),
        Err(error) => {
            return (
                Vec::new(),
                Some(format!("cannot read {}: {error}", path.display())),
            )
        }
    };
    match serde_json::from_slice::<Vec<SshHost>>(&bytes) {
        Ok(mut hosts) => {
            hosts.retain(|host| !host.id.trim().is_empty() && !host.host.trim().is_empty());
            (hosts, None)
        }
        Err(error) => {
            let aside = path.with_extension("json.corrupt");
            let _ = std::fs::rename(path, &aside);
            (
                Vec::new(),
                Some(format!(
                    "ssh host document was unreadable ({}); moved to {}",
                    error,
                    aside.display()
                )),
            )
        }
    }
}

/// Persist the host document atomically (temp file in the same directory, then
/// rename), owner-only where the platform supports POSIX modes.
pub fn save(path: &Path, hosts: &[SshHost]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    let json = serde_json::to_vec_pretty(hosts).map_err(|error| error.to_string())?;
    let tmp = path.with_extension(format!("json.tmp-{}", std::process::id()));
    std::fs::write(&tmp, &json)
        .map_err(|error| format!("cannot write {}: {error}", tmp.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, path).map_err(|error| {
        let _ = std::fs::remove_file(&tmp);
        format!("cannot replace {}: {error}", path.display())
    })
}

/// Generate an id the UI can treat as opaque.
pub fn new_id() -> String {
    let mut bytes = [0u8; 8];
    if getrandom::fill(&mut bytes).is_err() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        bytes = (nanos as u64).to_le_bytes();
    }
    format!(
        "ssh-{}",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

/// Validate a remote directory used as an authorization root.
pub fn canonical_dir(value: &str) -> Result<String, String> {
    validate_remote_path(value)?;
    normalize_remote_path(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(over: impl FnOnce(&mut SshHost)) -> SshHost {
        let mut value = SshHost {
            id: "ssh-1".into(),
            label: "Box".into(),
            host: "192.168.6.30".into(),
            port: None,
            user: Some("dongfan".into()),
            identity_file: None,
            default_dir: None,
            remote_shell: None,
        };
        over(&mut value);
        value
    }

    #[test]
    fn accepts_plain_hosts_and_targets() {
        assert_eq!(
            host(|_| {}).normalized().unwrap().target(),
            "dongfan@192.168.6.30"
        );
        assert_eq!(
            host(|h| {
                h.host = "dev-box".into();
                h.user = None;
            })
            .normalized()
            .unwrap()
            .target(),
            "dev-box"
        );
        assert!(host(|h| h.host = "[::1]".into()).normalized().is_ok());
    }

    #[test]
    fn rejects_option_splicing_and_competing_user_spellings() {
        for value in [
            "-oProxyCommand=x",
            "host name",
            "user@host",
            "",
            "host\nx",
            "host;rm",
        ] {
            let host = host(|h| h.host = value.into());
            assert!(host.normalized().is_err(), "{value:?} should be rejected");
        }
    }

    #[test]
    fn rejects_invalid_ports_users_keys_and_dirs() {
        assert!(host(|h| h.port = Some(0)).normalized().is_err());
        assert!(host(|h| h.user = Some("-root".into()))
            .normalized()
            .is_err());
        assert!(host(|h| h.user = Some("a b".into())).normalized().is_err());
        assert!(host(|h| h.identity_file = Some("id_ed25519".into()))
            .normalized()
            .is_err());
        assert!(host(|h| h.identity_file = Some("~/.ssh/id_ed25519".into()))
            .normalized()
            .is_ok());
        assert!(host(|h| h.default_dir = Some("relative".into()))
            .normalized()
            .is_err());
        assert!(host(|h| h.default_dir = Some("/home/u/../root".into()))
            .normalized()
            .is_ok());
        assert!(host(|h| h.remote_shell = Some("bash".into()))
            .normalized()
            .is_err());
        assert!(host(|h| h.remote_shell = Some("/bin/bash".into()))
            .normalized()
            .is_ok());
    }

    #[test]
    fn normalizes_the_default_directory() {
        assert_eq!(
            host(|h| h.default_dir = Some("/home//u/./p/".into()))
                .normalized()
                .unwrap()
                .default_dir
                .as_deref(),
            Some("/home/u/p")
        );
    }

    #[test]
    fn store_roundtrips_and_sets_corrupt_documents_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = document_path(dir.path());
        let hosts = vec![host(|_| {})];
        save(&path, &hosts).unwrap();
        let (loaded, warning) = load(&path);
        assert!(warning.is_none());
        assert_eq!(loaded, hosts);

        std::fs::write(&path, b"not json").unwrap();
        let (loaded, warning) = load(&path);
        assert!(loaded.is_empty());
        assert!(warning.unwrap().contains("unreadable"));
        assert!(dir.path().join("ssh-hosts.json.corrupt").exists());
    }

    #[test]
    fn missing_document_is_empty_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let (loaded, warning) = load(&document_path(dir.path()));
        assert!(loaded.is_empty());
        assert!(warning.is_none());
    }

    #[test]
    fn ids_are_generated_and_distinct() {
        let a = new_id();
        let b = new_id();
        assert!(a.starts_with("ssh-"));
        assert_ne!(a, b);
    }
}
