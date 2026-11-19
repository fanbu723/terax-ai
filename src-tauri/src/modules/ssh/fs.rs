//! Remote filesystem operations over the SSH transport.
//!
//! Each operation runs one small POSIX script on the remote host through
//! [`super::exec`]. The protocol is line based: the first line is `TERAX_OK` or
//! `TERAX_ERR\t<code>\t<base64 message>`, and payload lines follow. Strict
//! parsing matters: a remote shell that prints a banner or a command that dies
//! before the header must produce an error, never a half-parsed result.

use std::time::Duration;

use super::encoding;
use super::exec;
use super::hosts::SshHost;
use super::{paths, scripts};
use crate::modules::proc::capture::{Captured, Limits};

/// What a remote path is, at the same granularity the local provider reports.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemoteKind {
    File,
    Dir,
    Symlink,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteStat {
    pub kind: RemoteKind,
    pub size: u64,
    pub mtime: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteEntry {
    pub name: String,
    pub kind: RemoteKind,
    pub size: u64,
    pub mtime: u64,
}

/// One decoded remote reply.
enum Reply {
    Ok(Vec<String>),
    Err { code: String, message: String },
}

const LIST_STDOUT: usize = 8 * 1024 * 1024;
const READ_STDOUT: usize = 16 * 1024 * 1024;
const SMALL_STDOUT: usize = 64 * 1024;
const STDERR: usize = 16 * 1024;

fn limits(stdout: usize) -> Limits {
    Limits {
        stdout,
        stderr: STDERR,
        stop_on_stdout_cap: true,
    }
}

fn decode_payload(lines: Vec<String>) -> Result<Vec<String>, String> {
    Ok(lines)
}

/// Parse the protocol out of one captured command.
fn parse(captured: &Captured) -> Result<Reply, String> {
    if captured.timed_out {
        return Err("remote operation timed out".into());
    }
    if captured.stdout_truncated {
        return Err("remote output exceeded its bound".into());
    }
    let stdout = String::from_utf8_lossy(&captured.stdout);
    let mut lines = stdout.split('\n').map(str::to_string).collect::<Vec<_>>();
    // The payload is line separated and may end with a newline.
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    if lines.is_empty() {
        return Err(describe_failure(
            captured,
            "the remote command returned no output",
        ));
    }
    let header = lines.remove(0);
    let payload = lines;
    if header == "TERAX_OK" {
        return Ok(Reply::Ok(decode_payload(payload)?));
    }
    if let Some(rest) = header.strip_prefix("TERAX_ERR\t") {
        let mut fields = rest.splitn(2, '\t');
        let code = fields.next().unwrap_or("IO").to_string();
        let encoded = fields.next().unwrap_or_default();
        let message = encoding::decode(encoded)
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_else(|_| "the remote command failed".to_string());
        return Ok(Reply::Err { code, message });
    }
    Err(describe_failure(
        captured,
        "unexpected remote output (a login script may be writing to stdout)",
    ))
}

fn describe_failure(captured: &Captured, fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(&captured.stderr);
    let stderr = stderr.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }
    match captured.exit_code {
        Some(code) if code != 0 => format!("{fallback} (exit {code})"),
        _ => fallback.to_string(),
    }
}

fn expect_ok(reply: Reply) -> Result<Vec<String>, String> {
    match reply {
        Reply::Ok(payload) => Ok(payload),
        Reply::Err { code, message } => Err(map_error(&code, &message)),
    }
}

/// Map a protocol error code to the message the UI shows. Codes keep the local
/// provider's meaning so the frontend's existing handling still applies.
fn map_error(code: &str, message: &str) -> String {
    match code {
        "NOTFOUND" => message.to_string(),
        "NOTDIR" => message.to_string(),
        "NOTFILE" => message.to_string(),
        "TOOLARGE" => message.to_string(),
        "STALE" => message.to_string(),
        "CONFLICT" => message.to_string(),
        _ => message.to_string(),
    }
}

fn run(
    host: &SshHost,
    script: String,
    stdin: Option<Vec<u8>>,
    timeout: Duration,
    stdout_limit: usize,
) -> Result<Reply, String> {
    let captured = exec::run(host, &script, stdin, timeout, limits(stdout_limit))?;
    parse(&captured)
}

fn parse_kind(value: &str) -> RemoteKind {
    match value {
        "dir" => RemoteKind::Dir,
        "symlink" => RemoteKind::Symlink,
        _ => RemoteKind::File,
    }
}

fn parse_u64(value: &str) -> u64 {
    value.trim().parse::<u64>().unwrap_or(0)
}

/// Seconds from `stat` are widened to the millisecond scale the frontend uses.
fn parse_mtime_seconds(value: &str) -> u64 {
    parse_u64(value).saturating_mul(1000)
}

/// `stat` a remote path; `Ok(None)` when it does not exist.
pub fn stat(host: &SshHost, path: &str) -> Result<Option<RemoteStat>, String> {
    let reply = run(
        host,
        scripts::stat(path),
        None,
        exec::DEFAULT_TIMEOUT,
        SMALL_STDOUT,
    )?;
    match reply {
        Reply::Err { code, .. } if code == "NOTFOUND" => Ok(None),
        Reply::Err { code, message } => Err(map_error(&code, &message)),
        Reply::Ok(payload) => {
            let line = payload.first().ok_or("remote stat returned no fields")?;
            let mut fields = line.split('\t');
            let kind = parse_kind(fields.next().unwrap_or("file"));
            let info = fields.next().unwrap_or("0|0");
            let mut parts = info.split('|');
            let size = parse_u64(parts.next().unwrap_or("0"));
            let mtime = parse_mtime_seconds(parts.next().unwrap_or("0"));
            Ok(Some(RemoteStat { kind, size, mtime }))
        }
    }
}

/// List one remote directory. Hidden entries are returned; the caller filters.
pub fn list(host: &SshHost, dir: &str) -> Result<Vec<RemoteEntry>, String> {
    let reply = run(
        host,
        scripts::list(dir),
        None,
        Duration::from_secs(30),
        LIST_STDOUT,
    )?;
    let payload = expect_ok(reply)?;
    let mut entries = Vec::with_capacity(payload.len());
    for line in payload {
        if line.is_empty() {
            continue;
        }
        let mut fields = line.split('\t');
        let name = fields.next().unwrap_or_default();
        let kind = parse_kind(fields.next().unwrap_or("file"));
        let size = parse_u64(fields.next().unwrap_or("0"));
        let mtime = parse_mtime_seconds(fields.next().unwrap_or("0"));
        let name = encoding::decode(name)
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .map_err(|_| "remote directory listing carried an invalid entry name".to_string())?;
        entries.push(RemoteEntry {
            name,
            kind,
            size,
            mtime,
        });
    }
    Ok(entries)
}

/// Read a remote file as raw bytes plus its mtime (milliseconds).
pub fn read(host: &SshHost, path: &str, max_bytes: u64) -> Result<(Vec<u8>, u64), String> {
    let reply = run(
        host,
        scripts::read(path, max_bytes),
        None,
        Duration::from_secs(60),
        READ_STDOUT,
    )?;
    let payload = expect_ok(reply)?;
    let mut payload = payload.into_iter();
    let mtime = parse_mtime_seconds(&payload.next().unwrap_or_default());
    let encoded: String = payload.collect::<Vec<_>>().join("");
    let bytes = encoding::decode(&encoded)?;
    Ok((bytes, mtime))
}

/// Write `content` to a remote path atomically, optionally guarding against a
/// changed file. Returns the new mtime in milliseconds.
pub fn write(
    host: &SshHost,
    path: &str,
    content: &[u8],
    expected_mtime: Option<u64>,
) -> Result<u64, String> {
    let expected_seconds = expected_mtime.map(|mtime| mtime / 1000);
    let stdin = encoding::encode(content).into_bytes();
    let reply = run(
        host,
        scripts::write(path, expected_seconds),
        Some(stdin),
        Duration::from_secs(60),
        SMALL_STDOUT,
    )?;
    let payload = expect_ok(reply)?;
    Ok(parse_mtime_seconds(
        &payload.first().cloned().unwrap_or_default(),
    ))
}

/// Create an empty file; fails when the path exists.
pub fn create_file(host: &SshHost, path: &str) -> Result<(), String> {
    let reply = run(
        host,
        scripts::create_file(path),
        None,
        exec::DEFAULT_TIMEOUT,
        SMALL_STDOUT,
    )?;
    expect_ok(reply).map(|_| ())
}

/// Create a directory (the whole chain when `recursive`).
pub fn create_dir(host: &SshHost, path: &str, recursive: bool) -> Result<(), String> {
    let reply = run(
        host,
        scripts::mkdir(path, recursive),
        None,
        exec::DEFAULT_TIMEOUT,
        SMALL_STDOUT,
    )?;
    expect_ok(reply).map(|_| ())
}

/// Rename/replace, matching the local `fs_rename` behavior.
pub fn rename(host: &SshHost, from: &str, to: &str) -> Result<(), String> {
    let reply = run(
        host,
        scripts::rename(from, to),
        None,
        exec::DEFAULT_TIMEOUT,
        SMALL_STDOUT,
    )?;
    expect_ok(reply).map(|_| ())
}

/// Move without replacing an existing destination.
pub fn move_no_replace(host: &SshHost, from: &str, to: &str) -> Result<(), String> {
    let reply = run(
        host,
        scripts::move_no_replace(from, to),
        None,
        Duration::from_secs(60),
        SMALL_STDOUT,
    )?;
    expect_ok(reply).map(|_| ())
}

/// Delete a remote path recursively.
pub fn delete(host: &SshHost, path: &str) -> Result<(), String> {
    let reply = run(
        host,
        scripts::remove(path),
        None,
        Duration::from_secs(120),
        SMALL_STDOUT,
    )?;
    expect_ok(reply).map(|_| ())
}

/// Copy a remote path recursively without following symlinks.
pub fn copy(host: &SshHost, from: &str, to: &str) -> Result<(), String> {
    let reply = run(
        host,
        scripts::copy(from, to),
        None,
        Duration::from_secs(120),
        SMALL_STDOUT,
    )?;
    expect_ok(reply).map(|_| ())
}

/// Canonical remote path of an existing entry.
pub fn realpath(host: &SshHost, path: &str) -> Result<String, String> {
    let reply = run(
        host,
        scripts::realpath(path),
        None,
        exec::DEFAULT_TIMEOUT,
        SMALL_STDOUT,
    )?;
    let payload = expect_ok(reply)?;
    let canonical = payload
        .first()
        .map(|value| value.trim().to_string())
        .filter(|value| value.starts_with('/'))
        .ok_or_else(|| "the remote host returned an invalid canonical path".to_string())?;
    paths::normalize_remote_path(&canonical)
}

/// Read the remote `$HOME`.
pub fn home(host: &SshHost) -> Result<String, String> {
    let reply = run(
        host,
        scripts::probe_home(),
        None,
        exec::DEFAULT_TIMEOUT,
        SMALL_STDOUT,
    )?;
    let payload = expect_ok(reply)?;
    let home = payload
        .first()
        .map(|value| value.trim().to_string())
        .filter(|value| value.starts_with('/'))
        .ok_or_else(|| "the remote host did not report a home directory".to_string())?;
    paths::normalize_remote_path(&home)
}

/// Confirm a remote path is an existing directory.
pub fn require_dir(host: &SshHost, path: &str) -> Result<(), String> {
    let reply = run(
        host,
        scripts::require_dir(path),
        None,
        exec::DEFAULT_TIMEOUT,
        SMALL_STDOUT,
    )?;
    expect_ok(reply).map(|_| ())
}
