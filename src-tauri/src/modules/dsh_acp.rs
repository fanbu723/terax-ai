//! DSH (DeepSeek Harness) ACP stdio bridge.
//!
//! The in-app DSH console speaks the Agent Client Protocol as newline-delimited
//! JSON-RPC over the agent's stdio. This module owns the agent process and
//! pumps its pipes into `tauri::ipc::Channel`s. The lifecycle mirrors
//! `lsp/session.rs`: a SharedChild, one reader thread per pipe and a waiter,
//! with an explicit kill on Drop, on `RunEvent::Exit`, and when the frontend
//! channel goes away.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use shared_child::SharedChild;
use tauri::ipc::Channel;
use tauri::Manager;

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

/// Longest accepted agent command, in bytes.
const MAX_COMMAND_LEN: usize = 512;
/// Longest accepted single output line, in MiB.
const MAX_LINE_MIB: usize = 8;
const MAX_LINE_BYTES: usize = MAX_LINE_MIB * 1024 * 1024;
const READ_BUF: usize = 32 * 1024;
// Pipe pumps and the waiter only shuffle bytes, so they need little stack.
const THREAD_STACK: usize = 256 * 1024;
// How long the waiter lets the stdout pump drain after the child exits, so the
// last lines land before the exit event closes the stream.
const DRAIN_TIMEOUT: Duration = Duration::from_millis(500);

#[cfg(unix)]
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(10);

/// Which agent pipe an [`AcpEvent`] came from.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AcpStream {
    Stdout,
    Stderr,
}

impl AcpStream {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
        }
    }
}

/// One line of agent output. Stdout lines are ACP JSON-RPC; the frontend
/// parses them and treats unparsable lines as log noise.
#[derive(Clone, Serialize)]
pub struct AcpEvent {
    pub stream: AcpStream,
    pub line: String,
}

/// How the agent process ended, delivered once, after the output events.
#[derive(Clone, Serialize)]
pub struct AcpExit {
    /// `None` when the agent was killed by a signal (Unix) or the exit status
    /// is otherwise unavailable.
    pub code: Option<i32>,
}

struct AcpSession {
    #[cfg(windows)]
    job: Mutex<Option<crate::modules::proc::job::ProcessJob>>,
    child: Arc<SharedChild>,
    stdin: Mutex<Option<ChildStdin>>,
    exited: Arc<AtomicBool>,
}

impl AcpSession {
    /// Writes one newline-terminated ACP line. The stdin mutex serializes
    /// concurrent writes, so two JSON-RPC messages can never interleave.
    fn write_line(&self, line: &str) -> Result<(), String> {
        if line.len() > MAX_LINE_BYTES {
            return Err(format!("dsh_acp: line is longer than {MAX_LINE_MIB} MiB"));
        }
        if line.contains('\n') || line.contains('\r') {
            return Err("dsh_acp: line must not contain line breaks".into());
        }
        let mut guard = self.stdin.lock().unwrap();
        let stdin = guard.as_mut().ok_or("dsh_acp: stdin is closed")?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("dsh_acp write failed: {e}"))
    }

    fn kill(&self) {
        let _ = self.signal_kill();
    }

    // `exec` makes the agent the shell's own process, but it can still fork
    // helpers. Unix: signal the process group. Windows: the Job Object covers
    // the tree.
    fn signal_kill(&self) -> std::io::Result<()> {
        *self.stdin.lock().unwrap() = None;
        #[cfg(windows)]
        drop(self.job.lock().unwrap().take());
        #[cfg(unix)]
        if unsafe { libc::kill(-(self.child.id() as libc::pid_t), libc::SIGKILL) } != 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                return Err(error);
            }
        }
        self.child.kill()
    }

    fn kill_and_wait(&self) -> Result<(), String> {
        self.signal_kill()
            .map_err(|e| format!("dsh_acp kill failed: {e}"))?;
        self.child
            .wait()
            .map_err(|e| format!("dsh_acp wait failed: {e}"))?;
        Ok(())
    }
}

impl Drop for AcpSession {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Agents spawned by the DSH console, keyed by the id returned to the UI.
pub struct AcpState {
    next_id: AtomicU32,
    sessions: RwLock<HashMap<u32, Arc<AcpSession>>>,
}

impl Default for AcpState {
    fn default() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            sessions: RwLock::new(HashMap::new()),
        }
    }
}

impl AcpState {
    fn take(&self, id: u32) -> Option<Arc<AcpSession>> {
        self.sessions.write().unwrap().remove(&id)
    }

    /// Kills every live agent; called on window close and on app exit, where
    /// destructors are not guaranteed to run.
    pub fn close_all(&self) {
        let drained: Vec<Arc<AcpSession>> = self
            .sessions
            .write()
            .unwrap()
            .drain()
            .map(|(_, session)| session)
            .collect();
        for session in drained {
            session.kill();
        }
    }
}

/// A single line exceeded [`LineSplitter`]'s cap; the caller must stop the
/// agent before the rest of the line is buffered.
#[derive(Debug, PartialEq, Eq)]
struct LineTooLong;

/// Incremental byte splitter for newline-delimited output.
///
/// Lines are split on `\n` only; a trailing `\r` (CRLF framing) is stripped
/// and undecodable bytes are replaced lossily. A line longer than the cap is
/// reported as [`LineTooLong`] instead of being buffered without bound.
struct LineSplitter {
    pending: Vec<u8>,
    cap: usize,
}

impl LineSplitter {
    fn new() -> Self {
        Self::with_cap(MAX_LINE_BYTES)
    }

    fn with_cap(cap: usize) -> Self {
        Self {
            pending: Vec::new(),
            cap,
        }
    }

    /// Feeds a chunk of pipe bytes, returning every line it completed.
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, LineTooLong> {
        let mut lines = Vec::new();
        let mut start = 0;
        for (index, &byte) in chunk.iter().enumerate() {
            if byte != b'\n' {
                continue;
            }
            self.pending.extend_from_slice(&chunk[start..index]);
            if self.pending.len() > self.cap {
                self.pending.clear();
                return Err(LineTooLong);
            }
            lines.push(take_line(&mut self.pending));
            start = index + 1;
        }
        self.pending.extend_from_slice(&chunk[start..]);
        if self.pending.len() > self.cap {
            self.pending.clear();
            return Err(LineTooLong);
        }
        Ok(lines)
    }

    /// A final line that ended at EOF without a newline.
    fn finish(&mut self) -> Option<String> {
        if self.pending.is_empty() {
            return None;
        }
        Some(take_line(&mut self.pending))
    }
}

fn take_line(pending: &mut Vec<u8>) -> String {
    let mut bytes = std::mem::take(pending);
    if bytes.last() == Some(&b'\r') {
        bytes.pop();
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// The user's login-shell environment overlay for GUI launches.
///
/// Mirrors `lsp/env.rs`: GUI-launched apps inherit a bare PATH on macOS, and
/// the agent (npx/node) needs the user's PATH. Captured once and reused. The
/// helper is duplicated here because the lsp one is private to its module.
fn server_env_overlay() -> &'static HashMap<String, String> {
    static ENV: OnceLock<HashMap<String, String>> = OnceLock::new();
    ENV.get_or_init(|| {
        #[cfg(unix)]
        {
            match capture_login_env() {
                Some(env) => env,
                None => {
                    log::warn!("dsh_acp: login shell env capture failed, using process env");
                    HashMap::new()
                }
            }
        }
        #[cfg(windows)]
        {
            HashMap::new()
        }
    })
}

#[cfg(unix)]
fn capture_login_env() -> Option<HashMap<String, String>> {
    use std::sync::mpsc;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut cmd = Command::new(&shell);
    cmd.args(["-l", "-c", "/usr/bin/env -0"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let child = Arc::new(SharedChild::spawn(&mut cmd).ok()?);
    let mut stdout = child.take_stdout()?;
    let (tx, rx) = mpsc::channel();
    thread::Builder::new()
        .name("terax-dsh-acp-env-capture".into())
        .spawn(move || {
            let mut buf = Vec::with_capacity(8 * 1024);
            let _ = stdout.read_to_end(&mut buf);
            let _ = tx.send(buf);
        })
        .ok()?;

    let bytes = match rx.recv_timeout(CAPTURE_TIMEOUT) {
        Ok(bytes) => {
            let _ = child.wait();
            bytes
        }
        Err(_) => {
            log::warn!("dsh_acp: login shell env capture timed out after {CAPTURE_TIMEOUT:?}");
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    };

    let env: HashMap<String, String> = bytes
        .split(|&byte| byte == 0)
        .filter(|chunk| !chunk.is_empty())
        .filter_map(|chunk| {
            let text = std::str::from_utf8(chunk).ok()?;
            let (key, value) = text.split_once('=')?;
            if key.is_empty() {
                return None;
            }
            Some((key.to_string(), value.to_string()))
        })
        .collect();
    if env.is_empty() {
        return None;
    }
    Some(env)
}

fn spawn_thread(
    name: String,
    work: impl FnOnce() + Send + 'static,
) -> Result<thread::JoinHandle<()>, String> {
    thread::Builder::new()
        .name(name)
        .stack_size(THREAD_STACK)
        .spawn(work)
        .map_err(|e| e.to_string())
}

/// Builds the platform shell invocation for the agent command.
fn build_command(
    command: &str,
    #[cfg_attr(not(windows), allow(unused_variables))] workspace: &WorkspaceEnv,
    #[cfg_attr(not(windows), allow(unused_variables))] cwd: Option<&str>,
) -> Result<Command, String> {
    #[cfg(unix)]
    {
        // `exec` replaces the shell with the agent, so the child pid and the
        // process group a kill targets belong to the agent itself.
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c").arg(format!("exec {command}"));
        // Give the agent the user's login environment (PATH especially).
        cmd.envs(server_env_overlay());
        // AppImage injects its own library search paths into the process env;
        // strip them after the overlay, as shell_run_command does, so the
        // agent links against the host rather than the AppImage mount.
        for (key, value) in crate::modules::workspace::appimage_env_overrides() {
            match value {
                Some(value) => {
                    cmd.env(key, value);
                }
                None => {
                    cmd.env_remove(key);
                }
            }
        }
        Ok(cmd)
    }
    #[cfg(windows)]
    {
        let mut cmd = crate::modules::shell::build_oneshot_command(command, workspace, cwd)?;
        // Empty on Windows (the full user environment is inherited there);
        // the overlay still applies uniformly so both platforms share it.
        cmd.envs(server_env_overlay());
        Ok(cmd)
    }
}

fn spawn_pipe_reader(
    id: u32,
    stream: AcpStream,
    mut pipe: impl Read + Send + 'static,
    on_event: Channel<AcpEvent>,
    session: Arc<AcpSession>,
) -> Result<thread::JoinHandle<()>, String> {
    let name = format!("terax-dsh-acp-{}-{id}", stream.as_str());
    spawn_thread(name, move || {
        let mut splitter = LineSplitter::new();
        let mut buf = [0u8; READ_BUF];
        loop {
            match pipe.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => match splitter.push(&buf[..n]) {
                    Ok(lines) => {
                        for line in lines {
                            if on_event.send(AcpEvent { stream, line }).is_err() {
                                // The UI is gone; nobody would read the agent.
                                log::info!("dsh_acp id={id}: channel closed; killing agent");
                                session.kill();
                                return;
                            }
                        }
                    }
                    Err(LineTooLong) => {
                        let message = format!(
                            "dsh_acp: {} line exceeded the {MAX_LINE_MIB} MiB limit; killing the agent",
                            stream.as_str()
                        );
                        log::error!("dsh_acp id={id}: {message}");
                        let _ = on_event.send(AcpEvent {
                            stream: AcpStream::Stderr,
                            line: message,
                        });
                        session.kill();
                        return;
                    }
                },
                Err(e) => {
                    log::debug!("dsh_acp id={id} {} ended: {e}", stream.as_str());
                    break;
                }
            }
        }
        // A last line that hit EOF without its newline.
        if let Some(line) = splitter.finish() {
            let _ = on_event.send(AcpEvent { stream, line });
        }
    })
}

#[allow(clippy::too_many_arguments)]
fn spawn(
    id: u32,
    app: tauri::AppHandle,
    command: &str,
    workspace: &WorkspaceEnv,
    cwd: Option<&str>,
    authorized_cwd: Option<&Path>,
    on_event: Channel<AcpEvent>,
    on_exit: Channel<AcpExit>,
) -> Result<Arc<AcpSession>, String> {
    let mut cmd = build_command(command, workspace, cwd)?;
    // WSL cwds are passed to wsl.exe by build_oneshot_command; a local cwd is
    // the authorized canonical dir.
    if let (WorkspaceEnv::Local, Some(dir)) = (workspace, authorized_cwd) {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);
    // A dedicated process group lets the kill below reach anything the agent
    // forks, not just the agent itself.
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }

    let child = Arc::new(
        SharedChild::spawn(&mut cmd).map_err(|e| format!("dsh_acp: spawn failed: {e}"))?,
    );
    let kill_on_fail = || {
        let _ = child.kill();
    };
    let stdin = child.take_stdin().ok_or_else(|| {
        kill_on_fail();
        "dsh_acp: no stdin pipe".to_string()
    })?;
    let stdout = child.take_stdout().ok_or_else(|| {
        kill_on_fail();
        "dsh_acp: no stdout pipe".to_string()
    })?;
    let stderr = child.take_stderr().ok_or_else(|| {
        kill_on_fail();
        "dsh_acp: no stderr pipe".to_string()
    })?;

    // Windows: dropping the Job Object kills the whole tree, the only reliable
    // orphan guard there.
    #[cfg(windows)]
    let job = match crate::modules::proc::job::ProcessJob::create_for(child.id()) {
        Ok(job) => Some(job),
        Err(e) => {
            log::warn!("dsh_acp job-object setup failed for pid={}: {e}", child.id());
            None
        }
    };

    let session = Arc::new(AcpSession {
        #[cfg(windows)]
        job: Mutex::new(job),
        child: child.clone(),
        stdin: Mutex::new(Some(stdin)),
        exited: Arc::new(AtomicBool::new(false)),
    });

    let stdout_reader = spawn_pipe_reader(
        id,
        AcpStream::Stdout,
        stdout,
        on_event.clone(),
        session.clone(),
    )
    .map_err(|e| {
        session.kill();
        format!("dsh_acp: stdout reader failed: {e}")
    })?;
    let stderr_reader = spawn_pipe_reader(
        id,
        AcpStream::Stderr,
        stderr,
        on_event,
        session.clone(),
    )
    .map_err(|e| {
        session.kill();
        format!("dsh_acp: stderr reader failed: {e}")
    })?;

    let waiter_session = session.clone();
    let waiter_child = child;
    spawn_thread(format!("terax-dsh-acp-waiter-{id}"), move || {
        let code = match waiter_child.wait() {
            Ok(status) => status.code(),
            Err(e) => {
                log::warn!("dsh_acp id={id} wait failed: {e}");
                None
            }
        };
        waiter_session.exited.store(true, Ordering::Release);
        // Bounded, not joined: a forked grandchild inheriting a pipe keeps it
        // open past the agent's exit and would hang us.
        let deadline = Instant::now() + DRAIN_TIMEOUT;
        while Instant::now() < deadline
            && !(stdout_reader.is_finished() && stderr_reader.is_finished())
        {
            thread::sleep(Duration::from_millis(10));
        }
        if let Some(state) = app.try_state::<AcpState>() {
            state.take(id);
        }
        log::info!("dsh_acp id={id} exited code={code:?}");
        if on_exit.send(AcpExit { code }).is_err() {
            log::debug!("dsh_acp id={id} exit send failed (channel closed)");
        }
    })
    .map_err(|e| {
        session.kill();
        format!("dsh_acp: waiter failed: {e}")
    })?;

    Ok(session)
}

/// Validates the single-line shell command that starts the agent.
fn validate_command(command: &str) -> Result<&str, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("dsh_acp: command is empty".into());
    }
    if command.len() > MAX_COMMAND_LEN {
        return Err(format!(
            "dsh_acp: command is longer than {MAX_COMMAND_LEN} bytes"
        ));
    }
    // A control character (newline included) would smuggle a second command
    // into the shell invocation.
    if command.chars().any(char::is_control) {
        return Err("dsh_acp: command contains control characters".into());
    }
    Ok(command)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn dsh_acp_spawn(
    app: tauri::AppHandle,
    state: tauri::State<'_, AcpState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    command: String,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    on_event: Channel<AcpEvent>,
    on_exit: Channel<AcpExit>,
) -> Result<u32, String> {
    let command = validate_command(&command)?.to_string();
    let workspace = WorkspaceEnv::from_option(workspace);
    let authorized_cwd = authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    let spawn_command = command.clone();
    let spawn_workspace = workspace;
    let session = tauri::async_runtime::spawn_blocking(move || {
        spawn(
            id,
            app,
            &spawn_command,
            &spawn_workspace,
            cwd.as_deref(),
            authorized_cwd.as_deref(),
            on_event,
            on_exit,
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    state.sessions.write().unwrap().insert(id, session);
    // The agent can exit before this insert lands, and the waiter's `take`
    // then runs with the id absent. Re-check so a dead session is not
    // stranded in the map.
    let exited = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .map(|session| session.exited.load(Ordering::Acquire))
        .unwrap_or(false);
    if exited {
        state.take(id);
    }
    log::info!("dsh_acp spawned id={id} cmd={command}");
    Ok(id)
}

// Async so a stalled agent with a full stdin pipe blocks a worker thread,
// never the main thread.
#[tauri::command]
pub async fn dsh_acp_write(
    state: tauri::State<'_, AcpState>,
    id: u32,
    line: String,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("dsh_acp_write: unknown id={id}"))?;
    tauri::async_runtime::spawn_blocking(move || session.write_line(&line))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dsh_acp_kill(state: tauri::State<'_, AcpState>, id: u32) -> Result<(), String> {
    let session = state.sessions.read().unwrap().get(&id).cloned();
    if let Some(session) = session {
        tauri::async_runtime::spawn_blocking(move || session.kill_and_wait())
            .await
            .map_err(|e| e.to_string())??;
        state.take(id);
        log::info!("dsh_acp killed id={id}");
    }
    Ok(())
}

#[tauri::command]
pub fn dsh_acp_close_all(state: tauri::State<'_, AcpState>) {
    state.close_all();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitter_holds_a_half_line_until_the_newline_arrives() {
        let mut splitter = LineSplitter::new();
        assert!(splitter.push(b"{\"jsonrpc\"").unwrap().is_empty());
        assert_eq!(
            splitter.push(b":\"2.0\"}\n").unwrap(),
            vec!["{\"jsonrpc\":\"2.0\"}".to_string()]
        );
    }

    #[test]
    fn splitter_strips_crlf_but_keeps_inner_carriage_returns() {
        let mut splitter = LineSplitter::new();
        assert_eq!(
            splitter.push(b"a\r\nb\rc\n").unwrap(),
            vec!["a".to_string(), "b\rc".to_string()]
        );
    }

    #[test]
    fn splitter_emits_empty_lines() {
        let mut splitter = LineSplitter::new();
        assert_eq!(
            splitter.push(b"\n\n").unwrap(),
            vec![String::new(), String::new()]
        );
    }

    #[test]
    fn splitter_flushes_a_trailing_line_at_eof() {
        let mut splitter = LineSplitter::new();
        assert!(splitter.push(b"tail\r").unwrap().is_empty());
        assert_eq!(splitter.finish().as_deref(), Some("tail"));
        assert_eq!(splitter.finish(), None);
    }

    #[test]
    fn splitter_decodes_invalid_utf8_lossily() {
        let mut splitter = LineSplitter::new();
        assert_eq!(
            splitter.push(b"\xff\n").unwrap(),
            vec!["\u{fffd}".to_string()]
        );
    }

    #[test]
    fn splitter_rejects_a_partial_line_over_the_cap() {
        let mut splitter = LineSplitter::with_cap(4);
        assert!(splitter.push(b"1234").unwrap().is_empty());
        assert!(splitter.push(b"5").is_err());
    }

    #[test]
    fn splitter_rejects_a_completed_line_over_the_cap() {
        let mut splitter = LineSplitter::with_cap(4);
        assert!(splitter.push(b"12345\n").is_err());
    }

    #[test]
    fn command_validation_trims_and_accepts_a_plain_command() {
        assert_eq!(
            validate_command("  npx -y @deepseek-ai/dsh acp  ").unwrap(),
            "npx -y @deepseek-ai/dsh acp"
        );
    }

    #[test]
    fn command_validation_rejects_empty_commands() {
        assert!(validate_command("").is_err());
        assert!(validate_command(" \t\r\n").is_err());
    }

    #[test]
    fn command_validation_rejects_control_characters() {
        assert!(validate_command("dsh\tacp").is_err());
        assert!(validate_command("dsh\nacp").is_err());
        assert!(validate_command("dsh\0acp").is_err());
    }

    #[test]
    fn command_validation_enforces_the_length_cap() {
        assert!(validate_command(&"a".repeat(MAX_COMMAND_LEN)).is_ok());
        assert!(validate_command(&"a".repeat(MAX_COMMAND_LEN + 1)).is_err());
    }

    #[test]
    fn event_serializes_to_the_frontend_contract() {
        let event = AcpEvent {
            stream: AcpStream::Stdout,
            line: "{}".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&event).expect("serialize"),
            serde_json::json!({ "stream": "stdout", "line": "{}" })
        );
    }
}
