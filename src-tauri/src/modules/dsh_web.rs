//! Managed `dsh web` sidecar and its official DSH Web GUI window.
//!
//! `dsh` ships no terminal UI: its interactive surface is the Web GUI served by
//! `dsh web`, which carries what the automation-only ACP profile intentionally
//! omits (plans, slash commands, elicitation forms, settings and credentials).
//! Terax starts that server from the active workspace root, captures the
//! authenticated loopback URL from its stdout, and shows it in a dedicated
//! [`tauri::WebviewWindow`].
//!
//! The window is a top-level browsing context on purpose: DSH mints its session
//! cookie with `SameSite=Strict`, so an iframe embedded in the Terax origin
//! would never receive it. The window label is absent from every capability, so
//! the remote page gets no Tauri IPC.

use std::collections::VecDeque;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::Serialize;
use shared_child::SharedChild;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use super::dsh_acp::{
    build_command, spawn_thread, validate_shell_command, LineSplitter, LineTooLong,
};
use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

/// Window label of the official Web GUI. Deliberately absent from
/// `src-tauri/capabilities` so the external page has no IPC surface.
const WINDOW_LABEL: &str = "dsh-web";
const WINDOW_TITLE: &str = "DSH";
/// The line `dsh web` prints once its server is listening.
const URL_PREFIX: &str = "dsh web: ";
/// Boot includes profile auto-initialization on first run (15-20 s observed);
/// 120 s leaves room for slow machines without hanging the UI forever.
const START_TIMEOUT: Duration = Duration::from_secs(120);
const READ_BUF: usize = 32 * 1024;
/// How many stderr lines the error path keeps for diagnostics.
const STDERR_TAIL_LINES: usize = 40;
const EVENT_CHANGED: &str = "terax:dsh-web-changed";

/// One managed `dsh web` process plus everything needed to stop and diagnose it.
struct DshWebServer {
    child: Arc<SharedChild>,
    /// Authenticated loopback URL, including the one-time token. Never logged.
    url: String,
    port: u16,
    exited: Arc<AtomicBool>,
    #[cfg(windows)]
    job: Mutex<Option<crate::modules::proc::job::ProcessJob>>,
}

impl DshWebServer {
    fn kill(&self) {
        #[cfg(windows)]
        drop(
            self.job
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .take(),
        );
        #[cfg(unix)]
        unsafe {
            // `spawn_server` put the server in its own process group; signal
            // the group so node helpers die with it.
            libc::kill(-(self.child.id() as libc::pid_t), libc::SIGKILL);
        }
        let _ = self.child.kill();
    }

    fn kill_and_wait(&self) -> Result<(), String> {
        self.kill();
        self.child
            .wait()
            .map_err(|e| format!("dsh_web: wait failed: {e}"))?;
        Ok(())
    }
}

impl Drop for DshWebServer {
    fn drop(&mut self) {
        self.kill();
    }
}

/// What the frontend needs to render the Web GUI status. The token stays in
/// Rust: opening the window is a command, not a URL handed to the webview.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshWebStatus {
    pub port: u16,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DshWebEvent {
    running: bool,
    port: Option<u16>,
}

/// `Starting` is a claim so two concurrent starts cannot spawn two servers.
#[derive(Default)]
enum Slot {
    #[default]
    Idle,
    Starting,
    Running(Arc<DshWebServer>),
}

/// App-wide single `dsh web` instance: at most one managed server per process.
#[derive(Default)]
pub struct DshWebState {
    slot: Mutex<Slot>,
}

impl DshWebState {
    fn slot(&self) -> std::sync::MutexGuard<'_, Slot> {
        self.slot.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn status(&self) -> Option<DshWebStatus> {
        let mut slot = self.slot();
        if matches!(&*slot, Slot::Running(server) if server.exited.load(Ordering::Acquire)) {
            *slot = Slot::Idle;
            return None;
        }
        match &*slot {
            Slot::Running(server) => Some(DshWebStatus { port: server.port }),
            Slot::Idle | Slot::Starting => None,
        }
    }

    fn running(&self) -> Option<Arc<DshWebServer>> {
        let mut slot = self.slot();
        if matches!(&*slot, Slot::Running(server) if server.exited.load(Ordering::Acquire)) {
            *slot = Slot::Idle;
            return None;
        }
        match &*slot {
            Slot::Running(server) => Some(server.clone()),
            Slot::Idle | Slot::Starting => None,
        }
    }

    fn claim_start(&self) -> Result<(), String> {
        let mut slot = self.slot();
        if matches!(&*slot, Slot::Running(server) if server.exited.load(Ordering::Acquire)) {
            *slot = Slot::Idle;
        }
        match &*slot {
            Slot::Starting => Err("dsh_web: the DSH Web GUI is already starting".into()),
            Slot::Running(_) => Err("dsh_web: the DSH Web GUI is already running".into()),
            Slot::Idle => {
                *slot = Slot::Starting;
                Ok(())
            }
        }
    }

    fn finish_start(&self, server: Arc<DshWebServer>) {
        *self.slot() = Slot::Running(server);
    }

    fn fail_start(&self) {
        *self.slot() = Slot::Idle;
    }

    fn take(&self) -> Option<Arc<DshWebServer>> {
        match std::mem::replace(&mut *self.slot(), Slot::Idle) {
            Slot::Running(server) => Some(server),
            Slot::Idle | Slot::Starting => None,
        }
    }

    /// Kills the managed server; called on app exit, where destructors are not
    /// guaranteed to run.
    pub fn close_all(&self) {
        if let Some(server) = self.take() {
            server.kill();
        }
    }
}

/// Parses the `dsh web: <url>` startup line.
///
/// Only loopback http(s) URLs are accepted: the server binds the loopback
/// address by default and a non-loopback URL in stdout must not become a
/// window (or a browser tab) outside the user's machine.
fn parse_web_url(line: &str) -> Option<(String, u16)> {
    let raw = line.trim().strip_prefix(URL_PREFIX)?;
    let url = tauri::Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?;
    let loopback = host == "localhost"
        || host == "::1"
        || host == "[::1]"
        || host
            .strip_prefix("127.")
            .is_some_and(|rest| !rest.is_empty());
    if !loopback {
        return None;
    }
    let port = url.port_or_known_default()?;
    Some((raw.to_string(), port))
}

fn pump_stdout(
    mut pipe: impl Read + Send + 'static,
    tx: mpsc::Sender<(String, u16)>,
) -> Result<JoinHandle<()>, String> {
    spawn_thread("terax-dsh-web-stdout".into(), move || {
        let mut splitter = LineSplitter::new();
        let mut buf = [0u8; READ_BUF];
        let mut found = false;
        let mut tx = Some(tx);
        loop {
            match pipe.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => match splitter.push(&buf[..n]) {
                    Ok(lines) => {
                        for line in lines {
                            if found {
                                continue;
                            }
                            if let Some((url, port)) = parse_web_url(&line) {
                                found = true;
                                if let Some(sender) = tx.take() {
                                    let _ = sender.send((url, port));
                                }
                            }
                        }
                    }
                    Err(LineTooLong) => {
                        log::warn!("dsh_web: stdout line exceeded the line cap; ignored");
                    }
                },
                Err(error) => {
                    log::debug!("dsh_web: stdout ended: {error}");
                    break;
                }
            }
        }
        if !found {
            let tail = splitter.finish();
            if let Some((url, port)) = tail.as_deref().and_then(parse_web_url) {
                if let Some(sender) = tx.take() {
                    let _ = sender.send((url, port));
                }
            }
        }
        // Dropping `tx` here disconnects the receiver when no URL ever arrives.
    })
}

fn pump_stderr(
    mut pipe: impl Read + Send + 'static,
    tail: Arc<Mutex<VecDeque<String>>>,
) -> Result<JoinHandle<()>, String> {
    spawn_thread("terax-dsh-web-stderr".into(), move || {
        let mut splitter = LineSplitter::new();
        let mut buf = [0u8; READ_BUF];
        loop {
            match pipe.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => match splitter.push(&buf[..n]) {
                    Ok(lines) => {
                        let mut guard = tail.lock().unwrap_or_else(|error| error.into_inner());
                        for line in lines {
                            log::debug!("dsh_web stderr: {line}");
                            guard.push_back(line);
                            if guard.len() > STDERR_TAIL_LINES {
                                guard.pop_front();
                            }
                        }
                    }
                    Err(LineTooLong) => {
                        log::warn!("dsh_web: stderr line exceeded the line cap; ignored");
                    }
                },
                Err(error) => {
                    log::debug!("dsh_web: stderr ended: {error}");
                    break;
                }
            }
        }
    })
}

/// Spawns the server and waits for the URL line. `app` is only used to publish
/// exit events; tests pass `None`.
fn spawn_server(
    app: Option<tauri::AppHandle>,
    command: &str,
    cwd: Option<&Path>,
) -> Result<Arc<DshWebServer>, String> {
    let cwd_str = cwd.and_then(|dir| dir.to_str());
    let mut cmd = build_command(command, &WorkspaceEnv::Local, cwd_str)?;
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }

    let child =
        Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| format!("dsh_web: spawn failed: {e}"))?);
    let stdout = child.take_stdout().ok_or_else(|| {
        let _ = child.kill();
        "dsh_web: no stdout pipe".to_string()
    })?;
    let stderr = child.take_stderr().ok_or_else(|| {
        let _ = child.kill();
        "dsh_web: no stderr pipe".to_string()
    })?;

    #[cfg(windows)]
    let job = match crate::modules::proc::job::ProcessJob::create_for(child.id()) {
        Ok(job) => Some(job),
        Err(error) => {
            log::warn!(
                "dsh_web job-object setup failed for pid={}: {error}",
                child.id()
            );
            None
        }
    };

    let exited = Arc::new(AtomicBool::new(false));
    let stderr_tail = Arc::new(Mutex::new(VecDeque::new()));
    let (tx, rx) = mpsc::channel::<(String, u16)>();

    if let Err(error) = pump_stdout(stdout, tx) {
        let _ = child.kill();
        return Err(error);
    }
    if let Err(error) = pump_stderr(stderr, stderr_tail.clone()) {
        let _ = child.kill();
        return Err(error);
    }

    let waiter_child = child.clone();
    let waiter_exited = exited.clone();
    spawn_thread("terax-dsh-web-waiter".into(), move || {
        let code = match waiter_child.wait() {
            Ok(status) => status.code(),
            Err(error) => {
                log::warn!("dsh_web: wait failed: {error}");
                None
            }
        };
        waiter_exited.store(true, Ordering::Release);
        log::info!("dsh_web: dsh web exited code={code:?}");
        if let Some(app) = app {
            let _ = app.emit(
                EVENT_CHANGED,
                DshWebEvent {
                    running: false,
                    port: None,
                },
            );
        }
    })
    .map_err(|error| {
        let _ = child.kill();
        format!("dsh_web: waiter failed: {error}")
    })?;

    let parsed = match rx.recv_timeout(START_TIMEOUT) {
        Ok(parsed) => parsed,
        Err(RecvTimeoutError::Timeout) => {
            let _ = child.kill();
            let tail = stderr_tail
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            return Err(if tail.is_empty() {
                format!(
                    "dsh_web: `dsh web` did not report its URL within {}s",
                    START_TIMEOUT.as_secs()
                )
            } else {
                format!(
                    "dsh_web: `dsh web` did not report its URL within {}s: {tail}",
                    START_TIMEOUT.as_secs()
                )
            });
        }
        Err(RecvTimeoutError::Disconnected) => {
            let _ = child.kill();
            let tail = stderr_tail
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            return Err(if tail.is_empty() {
                "dsh_web: `dsh web` exited before reporting its URL".to_string()
            } else {
                format!("dsh_web: `dsh web` exited before reporting its URL: {tail}")
            });
        }
    };
    if exited.load(Ordering::Acquire) {
        let _ = child.kill();
        return Err("dsh_web: `dsh web` exited right after reporting its URL".into());
    }

    let (url, port) = parsed;
    Ok(Arc::new(DshWebServer {
        child,
        url,
        port,
        exited,
        #[cfg(windows)]
        job: Mutex::new(job),
    }))
}

fn open_window(app: &tauri::AppHandle, url: tauri::Url) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window
            .navigate(url)
            .map_err(|e| format!("dsh_web: navigate failed: {e}"))?;
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(url))
        .title(WINDOW_TITLE)
        .inner_size(1200.0, 800.0)
        .min_inner_size(720.0, 480.0)
        .resizable(true)
        .visible(true);
    let builder = if let Some(main) = app.get_webview_window("main") {
        builder
            .parent(&main)
            .map_err(|e| format!("dsh_web: parent failed: {e}"))?
    } else {
        builder
    };
    builder
        .build()
        .map_err(|e| format!("dsh_web: window failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn dsh_web_status(state: tauri::State<'_, DshWebState>) -> Option<DshWebStatus> {
    state.status()
}

#[tauri::command]
pub async fn dsh_web_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, DshWebState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    command: String,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<DshWebStatus, String> {
    if let Some(status) = state.status() {
        return Ok(status);
    }
    state.claim_start()?;

    let command = match validate_shell_command("dsh_web", &command) {
        Ok(command) => command.to_string(),
        Err(error) => {
            state.fail_start();
            return Err(error);
        }
    };
    let workspace = WorkspaceEnv::from_option(workspace);
    if !matches!(workspace, WorkspaceEnv::Local) {
        state.fail_start();
        return Err("dsh_web: the DSH Web GUI only supports local workspaces".into());
    }
    let authorized_cwd = match authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace) {
        Ok(dir) => dir,
        Err(error) => {
            state.fail_start();
            return Err(error);
        }
    };

    let spawn_app = app.clone();
    let spawned = tauri::async_runtime::spawn_blocking(move || {
        spawn_server(Some(spawn_app), &command, authorized_cwd.as_deref())
    })
    .await;

    match spawned {
        Ok(Ok(server)) => {
            let status = DshWebStatus { port: server.port };
            state.finish_start(server);
            let _ = app.emit(
                EVENT_CHANGED,
                DshWebEvent {
                    running: true,
                    port: Some(status.port),
                },
            );
            Ok(status)
        }
        Ok(Err(error)) => {
            state.fail_start();
            Err(error)
        }
        Err(error) => {
            state.fail_start();
            Err(format!("dsh_web: start task failed: {error}"))
        }
    }
}

#[tauri::command]
pub async fn dsh_web_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, DshWebState>,
) -> Result<String, String> {
    let server = state
        .running()
        .ok_or("dsh_web: the DSH Web GUI is not running")?;
    let url = tauri::Url::parse(&server.url).map_err(|e| format!("dsh_web: bad URL: {e}"))?;
    match open_window(&app, url.clone()) {
        Ok(()) => Ok("window".to_string()),
        Err(error) => {
            log::warn!("dsh_web: window failed ({error}); falling back to the system browser");
            app.opener()
                .open_url(url.as_str().to_string(), None::<String>)
                .map_err(|e| format!("dsh_web: could not open a browser: {e}"))?;
            Ok("browser".to_string())
        }
    }
}

#[tauri::command]
pub async fn dsh_web_stop(
    app: tauri::AppHandle,
    state: tauri::State<'_, DshWebState>,
) -> Result<(), String> {
    if let Some(server) = state.take() {
        tauri::async_runtime::spawn_blocking(move || server.kill_and_wait())
            .await
            .map_err(|e| format!("dsh_web: stop task failed: {e}"))??;
    }
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
    }
    let _ = app.emit(
        EVENT_CHANGED,
        DshWebEvent {
            running: false,
            port: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn dsh_web_close_all(state: tauri::State<'_, DshWebState>) {
    state.close_all();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_startup_url_line() {
        assert_eq!(
            parse_web_url("dsh web: http://127.0.0.1:40913/?token=abc"),
            Some(("http://127.0.0.1:40913/?token=abc".to_string(), 40913))
        );
        assert_eq!(
            parse_web_url("  dsh web: http://localhost:3080/  "),
            Some(("http://localhost:3080/".to_string(), 3080))
        );
        assert_eq!(
            parse_web_url("dsh web: https://[::1]:8443/?token=abc"),
            Some(("https://[::1]:8443/?token=abc".to_string(), 8443))
        );
    }

    #[test]
    fn rejects_non_loopback_or_foreign_lines() {
        for line in [
            "dsh web: http://192.168.1.10:3080/",
            "dsh web: https://example.com/",
            "dsh web: file:///tmp/thing",
            "dsh web: not a url",
            "starting dsh web: http://127.0.0.1:3080/",
            "",
        ] {
            assert_eq!(parse_web_url(line), None, "line: {line:?}");
        }
    }

    #[cfg(unix)]
    fn fake_dsh(dir: &Path, body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let script = dir.join("fake-dsh.sh");
        std::fs::write(&script, format!("#!/bin/sh\n{body}\n")).expect("write fake dsh");
        let mut permissions = std::fs::metadata(&script).expect("stat").permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&script, permissions).expect("chmod");
        script
    }

    #[cfg(unix)]
    #[test]
    fn starts_a_fake_dsh_and_stops_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let script = fake_dsh(
            dir.path(),
            "echo 'dsh web: http://127.0.0.1:39123/?token=test'\nexec sleep 30",
        );
        let command = format!("/bin/sh {}", script.display());
        let server = spawn_server(None, &command, Some(dir.path())).expect("start");

        assert_eq!(server.url, "http://127.0.0.1:39123/?token=test");
        assert_eq!(server.port, 39123);
        assert!(!server.exited.load(Ordering::Acquire));

        server.kill_and_wait().expect("stop");
        assert!(server.exited.load(Ordering::Acquire));
    }

    #[cfg(unix)]
    #[test]
    fn reports_an_early_exit_without_a_url() {
        let dir = tempfile::tempdir().expect("tempdir");
        let script = fake_dsh(dir.path(), "echo 'boom' >&2\nexit 3");
        let command = format!("/bin/sh {}", script.display());
        let error = match spawn_server(None, &command, Some(dir.path())) {
            Ok(_) => panic!("expected the fake dsh to fail"),
            Err(error) => error,
        };
        assert!(
            error.contains("exited before reporting its URL"),
            "unexpected error: {error}"
        );
    }
}
