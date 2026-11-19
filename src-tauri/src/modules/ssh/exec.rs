//! OpenSSH client invocation: binary resolution, argument construction and the
//! bounded one-shot runner used by the remote filesystem and shell commands.
//!
//! The transport deliberately delegates authentication, `known_hosts`, agent
//! forwarding, `ProxyJump` and `~/.ssh/config` handling to the system OpenSSH
//! client. There is no Rust SSH stack in the product and no credential stored
//! by Terax.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::Duration;

use super::hosts::SshHost;
use crate::modules::proc::capture::{self, Captured, Limits};
use crate::modules::proc::hide_console;

/// Connection setup budget for one administrative request.
pub const CONNECT_TIMEOUT_SECS: u64 = 10;
/// Deadline for a remote filesystem or probe request.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(20);

static SSH_BINARY: OnceLock<Result<PathBuf, String>> = OnceLock::new();
static CONTROL_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Resolve the OpenSSH client once per process.
pub fn ssh_binary() -> Result<PathBuf, String> {
    SSH_BINARY.get_or_init(resolve_ssh_binary).clone()
}

fn resolve_ssh_binary() -> Result<PathBuf, String> {
    if let Some(configured) = std::env::var_os("TERAX_SSH_BIN") {
        let path = PathBuf::from(configured);
        if path.is_absolute() {
            return Ok(path);
        }
        return Err("TERAX_SSH_BIN must be an absolute path".into());
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        if let Some(windir) = std::env::var_os("WINDIR") {
            candidates.push(
                PathBuf::from(windir)
                    .join("System32")
                    .join("OpenSSH")
                    .join("ssh.exe"),
            );
        }
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("OpenSSH").join("ssh.exe"));
        }
    }
    #[cfg(not(windows))]
    {
        candidates.push(PathBuf::from("/usr/bin/ssh"));
        candidates.push(PathBuf::from("/usr/local/bin/ssh"));
        candidates.push(PathBuf::from("/bin/ssh"));
    }
    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    which::which("ssh").map_err(|_| {
        "the OpenSSH client (ssh) was not found; install it (on Windows enable the OpenSSH Client optional feature) and restart Terax".to_string()
    })
}

/// Single-quote a value for a POSIX shell. Single quotes survive verbatim, and
/// an embedded quote is closed, escaped and reopened.
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// The remote command string that runs `script` with the remote `sh`.
fn remote_script_command(script: &str) -> String {
    format!("sh -c {}", shell_quote(script))
}

/// Options every request shares, before the target.
fn common_options(interactive: bool) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    let mut option = |value: String| {
        args.push("-o".to_string());
        args.push(value);
    };
    if !interactive {
        option("BatchMode=yes".into());
    }
    option(format!("ConnectTimeout={CONNECT_TIMEOUT_SECS}"));
    option("ServerAliveInterval=15".into());
    option("ServerAliveCountMax=3".into());
    if interactive {
        args.push("-tt".to_string());
    } else {
        args.push("-T".to_string());
    }
    args
}

#[cfg(unix)]
fn multiplex_options() -> Vec<String> {
    let Some(dir) = control_directory() else {
        return Vec::new();
    };
    vec![
        "-o".into(),
        "ControlMaster=auto".into(),
        "-o".into(),
        format!("ControlPath={}", dir.join("cm-%C").display()),
        "-o".into(),
        "ControlPersist=120".into(),
    ]
}

#[cfg(not(unix))]
fn multiplex_options() -> Vec<String> {
    Vec::new()
}

#[cfg(unix)]
fn control_directory() -> Option<PathBuf> {
    CONTROL_DIR
        .get_or_init(|| {
            let dir = dirs::cache_dir()?.join("terax").join("ssh");
            std::fs::create_dir_all(&dir).ok()?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
            }
            Some(dir)
        })
        .clone()
}

/// Host-specific options (`-p`, `-i`, `-l`).
fn host_options(host: &SshHost) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(port) = host.port {
        args.push("-p".into());
        args.push(port.to_string());
    }
    if let Some(user) = &host.user {
        args.push("-l".into());
        args.push(user.clone());
    }
    if let Some(identity) = &host.identity_file {
        args.push("-i".into());
        args.push(identity.clone());
    }
    args
}

/// Argument vector for one administrative request. The last element is the
/// single remote command string; OpenSSH joins the trailing arguments, so the
/// script is quoted as a whole and passed once.
pub fn exec_argv(host: &SshHost, script: &str) -> Result<Vec<String>, String> {
    let mut args = common_options(false);
    args.extend(multiplex_options());
    args.extend(host_options(host));
    args.push("--".into());
    args.push(host.target());
    args.push(remote_script_command(script));
    Ok(args)
}

/// One-shot command execution: the login shell semantics the agent's Bash and
/// one-shot shell commands expect, with the remote cwd applied first.
pub fn oneshot_command(
    host: &SshHost,
    command: &str,
    cwd: Option<&str>,
) -> Result<Command, String> {
    let mut script = String::new();
    if let Some(cwd) = cwd.filter(|value| !value.trim().is_empty()) {
        script.push_str("cd -- ");
        script.push_str(&shell_quote(cwd));
        script.push_str(" 2>/dev/null || exit 1; ");
    }
    script.push_str("exec sh -lc ");
    script.push_str(&shell_quote(command));
    let program = ssh_binary()?;
    let args = exec_argv(host, &script)?;
    let mut cmd = Command::new(&program);
    cmd.args(&args);
    Ok(cmd)
}

/// Everything the PTY layer needs to launch an interactive remote shell.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PtyLaunch {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// Shell name reported to the frontend for input quoting.
    pub login_shell: String,
}

/// The interactive command: change into the remote directory, then replace the
/// login shell so signals and exit status belong to it, not to `sh`.
fn interactive_remote_command(
    host: &SshHost,
    cwd: Option<&str>,
    remote_shell: Option<&str>,
) -> Result<(String, String), String> {
    let shell = match remote_shell {
        Some(shell) => shell_quote(shell),
        None => "\"${SHELL:-/bin/sh}\"".to_string(),
    };
    let login_shell = remote_shell
        .map(|shell| shell.rsplit('/').next().unwrap_or(shell).to_string())
        .unwrap_or_else(|| "sh".to_string());
    let mut command =
        String::from("TERM=xterm-256color COLORTERM=truecolor; export TERM COLORTERM; ");
    if let Some(cwd) = cwd.filter(|value| !value.trim().is_empty()) {
        command.push_str("cd -- ");
        command.push_str(&shell_quote(cwd));
        command.push_str(" 2>/dev/null; ");
    }
    command.push_str("exec ");
    command.push_str(&shell);
    command.push_str(" -l");
    // The host's configured shell (or the remote fallback name) tells the
    // frontend which shell-specific quoting applies.
    let login_shell = host
        .remote_shell
        .as_deref()
        .map(|shell| shell.rsplit('/').next().unwrap_or(shell).to_string())
        .unwrap_or(login_shell);
    Ok((command, login_shell))
}

/// Argument vector for the interactive terminal.
pub fn pty_launch(host: &SshHost, cwd: Option<&str>) -> Result<PtyLaunch, String> {
    let program = ssh_binary()?;
    let (command, login_shell) =
        interactive_remote_command(host, cwd, host.remote_shell.as_deref())?;
    let mut args = common_options(true);
    args.extend(host_options(host));
    args.push("--".into());
    args.push(host.target());
    args.push(command);
    Ok(PtyLaunch {
        program,
        args,
        login_shell,
    })
}

/// One bounded administrative request. `stdin` feeds the remote script (file
/// contents); output is capped by `limits`.
pub fn run(
    host: &SshHost,
    script: &str,
    stdin: Option<Vec<u8>>,
    timeout: Duration,
    limits: Limits,
) -> Result<Captured, String> {
    let program = ssh_binary()?;
    let args = exec_argv(host, script)?;
    let mut cmd = Command::new(&program);
    cmd.args(&args);
    if stdin.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    hide_console(&mut cmd);
    capture::run_with_input(&mut cmd, timeout, limits, stdin)
        .map_err(|error| format!("could not run {}: {error}", program.display()))
}

/// Classify an OpenSSH failure into the vocabulary the probe surfaces.
pub fn classify_failure(exit_code: Option<i32>, stderr: &str) -> &'static str {
    let lower = stderr.to_lowercase();
    if lower.contains("host key verification failed")
        || lower.contains("remote host identification has changed")
        || lower.contains("no matching host key")
    {
        return "host-key-untrusted";
    }
    if lower.contains("permission denied")
        || lower.contains("authentication failed")
        || lower.contains("too many authentication failures")
        || lower.contains("no more authentication methods")
    {
        return "auth-needed";
    }
    if lower.contains("could not resolve hostname")
        || lower.contains("connection refused")
        || lower.contains("connection timed out")
        || lower.contains("no route to host")
        || lower.contains("network is unreachable")
        || lower.contains("operation timed out")
        || lower.contains("permission denied (publickey,password)")
    {
        return "unreachable";
    }
    if exit_code == Some(255) {
        return "failed";
    }
    "failed"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host() -> SshHost {
        SshHost {
            id: "ssh-1".into(),
            label: "Box".into(),
            host: "dev.example".into(),
            port: Some(2222),
            user: Some("me".into()),
            identity_file: Some("/home/me/.ssh/id_ed25519".into()),
            default_dir: None,
            remote_shell: Some("/bin/bash".into()),
        }
    }

    #[test]
    fn quotes_embedded_single_quotes() {
        assert_eq!(shell_quote("plain"), "'plain'");
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
        assert_eq!(shell_quote("a b;$(id)"), "'a b;$(id)'");
    }

    #[test]
    fn exec_argv_places_the_script_as_one_remote_command() {
        let args = exec_argv(&host(), "printf ok").unwrap();
        assert!(args.contains(&"-T".to_string()));
        assert!(args.contains(&"BatchMode=yes".to_string()));
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"2222".to_string()));
        assert!(args.contains(&"-l".to_string()));
        assert!(args.contains(&"me".to_string()));
        assert!(args.contains(&"-i".to_string()));
        let target = args.iter().position(|arg| arg == "--").unwrap();
        assert_eq!(args[target + 1], "me@dev.example");
        assert_eq!(args[target + 2], "sh -c 'printf ok'");
        assert_eq!(args.len(), target + 3);
    }

    #[test]
    fn pty_launch_uses_a_tty_and_a_login_shell() {
        let launch = pty_launch(&host(), Some("/home/me/project")).unwrap();
        assert!(launch.args.contains(&"-tt".to_string()));
        let command = launch.args.last().unwrap();
        assert!(command.contains("cd -- '/home/me/project'"));
        assert!(command.contains("exec '/bin/bash' -l"));
        assert_eq!(launch.login_shell, "bash");
    }

    #[test]
    fn pty_launch_falls_back_to_the_remote_shell_variable() {
        let mut bare = host();
        bare.remote_shell = None;
        let launch = pty_launch(&bare, None).unwrap();
        let command = launch.args.last().unwrap();
        assert!(command.contains("exec \"${SHELL:-/bin/sh}\" -l"));
    }

    #[test]
    fn classifies_common_openssh_failures() {
        assert_eq!(
            classify_failure(Some(255), "Host key verification failed."),
            "host-key-untrusted"
        );
        assert_eq!(
            classify_failure(Some(255), "me@host: Permission denied (publickey)."),
            "auth-needed"
        );
        assert_eq!(
            classify_failure(Some(255), "ssh: Could not resolve hostname nope"),
            "unreachable"
        );
        assert_eq!(classify_failure(Some(1), "boom"), "failed");
    }
}
