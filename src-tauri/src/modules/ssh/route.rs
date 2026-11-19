//! Command adapters that serve the existing filesystem commands from a remote
//! workspace.
//!
//! The local commands keep their exact behavior; these functions map the remote
//! primitives onto the same result types so the frontend's explorer/editor code
//! does not need a second code path. Every path is normalized and checked
//! against the roots the user authorized for that host.

use super::fs as remote;
use super::paths;
use super::{fs::RemoteKind, RemoteRoots};
use crate::modules::fs::copy::{CopyFailure, CopyResult};
use crate::modules::fs::file::{
    FileStat, ReadResult, StatKind, BINARY_SNIFF_BYTES, MAX_READ_BYTES,
};
use crate::modules::fs::mutate::FsMoveResult;
use crate::modules::fs::tree::DirEntry;

const MAX_COPY_SOURCES: usize = 1024;
const MAX_COPY_SUFFIX: usize = 10_000;

/// The most a remote editor read may transfer. The transport caps a base64
/// payload at 16 MiB, so a forced open stays at the normal remote ceiling.
const REMOTE_MAX_READ_BYTES: u64 = MAX_READ_BYTES;

fn kind_of(kind: RemoteKind) -> StatKind {
    match kind {
        RemoteKind::File => StatKind::File,
        RemoteKind::Dir => StatKind::Dir,
        RemoteKind::Symlink => StatKind::Symlink,
    }
}

/// Read a remote file for the editor, mirroring `fs_read_file`.
pub fn read_file(remote: &RemoteRoots, path: &str, _force: bool) -> Result<ReadResult, String> {
    let path = remote.normalize(path)?;
    let Some(info) = remote::stat(&remote.host, &path)? else {
        return Err(format!("no such file or directory: {path}"));
    };
    if info.kind != RemoteKind::File {
        return Err("only regular files can be opened in the editor".into());
    }
    if info.size > REMOTE_MAX_READ_BYTES {
        return Ok(ReadResult::TooLarge {
            size: info.size,
            limit: REMOTE_MAX_READ_BYTES,
        });
    }
    let (bytes, mtime) = remote::read(&remote.host, &path, REMOTE_MAX_READ_BYTES)?;
    let size = bytes.len() as u64;
    if size > REMOTE_MAX_READ_BYTES {
        return Ok(ReadResult::TooLarge {
            size,
            limit: REMOTE_MAX_READ_BYTES,
        });
    }
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Ok(ReadResult::Binary { size });
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadResult::Text {
            content,
            size,
            mtime,
        }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

/// Write a remote file for the editor, returning its new mtime.
pub fn write_file(remote: &RemoteRoots, path: &str, content: &str) -> Result<u64, String> {
    let path = remote.normalize(path)?;
    remote::write(&remote.host, &path, content.as_bytes(), None)
}

/// `stat` a remote path.
pub fn stat(remote: &RemoteRoots, path: &str) -> Result<Option<FileStat>, String> {
    let path = remote.normalize(path)?;
    Ok(remote::stat(&remote.host, &path)?.map(|info| FileStat {
        size: info.size,
        mtime: info.mtime,
        kind: kind_of(info.kind),
    }))
}

/// Canonical remote path of an existing entry.
pub fn canonicalize(remote: &RemoteRoots, path: &str) -> Result<String, String> {
    let path = remote.normalize(path)?;
    remote::realpath(&remote.host, &path)
}

/// List a remote directory, mirroring `fs_read_dir` (hidden filtering and
/// sorting are done here; git decorations have no remote implementation yet).
pub fn read_dir(
    remote: &RemoteRoots,
    path: &str,
    show_hidden: bool,
) -> Result<Vec<DirEntry>, String> {
    let path = remote.normalize(path)?;
    let entries = remote::list(&remote.host, &path)?;
    let mut out: Vec<DirEntry> = entries
        .into_iter()
        .filter(|entry| show_hidden || !entry.name.starts_with('.'))
        .map(|entry| DirEntry {
            name: entry.name,
            kind: match entry.kind {
                RemoteKind::File => crate::modules::fs::tree::EntryKind::File,
                RemoteKind::Dir => crate::modules::fs::tree::EntryKind::Dir,
                RemoteKind::Symlink => crate::modules::fs::tree::EntryKind::Symlink,
            },
            size: entry.size,
            mtime: entry.mtime,
            gitignored: false,
        })
        .collect();
    crate::modules::fs::tree::sort_entries(&mut out);
    Ok(out)
}

/// List immediate remote subdirectories (breadcrumb helper).
pub fn subdirs(remote: &RemoteRoots, path: &str, show_hidden: bool) -> Result<Vec<String>, String> {
    let path = remote.normalize(path)?;
    let entries = remote::list(&remote.host, &path)?;
    let mut names: Vec<String> = entries
        .into_iter()
        .filter(|entry| show_hidden || !entry.name.starts_with('.'))
        .filter(|entry| entry.kind == RemoteKind::Dir)
        .map(|entry| entry.name)
        .collect();
    names.sort();
    Ok(names)
}

pub fn create_file(remote: &RemoteRoots, path: &str) -> Result<(), String> {
    let path = remote.normalize(path)?;
    remote::create_file(&remote.host, &path)
}

pub fn create_dir(remote: &RemoteRoots, path: &str) -> Result<(), String> {
    let path = remote.normalize(path)?;
    remote::create_dir(&remote.host, &path, true)
}

pub fn rename(remote: &RemoteRoots, from: &str, to: &str) -> Result<(), String> {
    let from = remote.normalize(from)?;
    let to = remote.normalize(to)?;
    if from == to {
        return Ok(());
    }
    remote::rename(&remote.host, &from, &to)
}

pub fn delete(remote: &RemoteRoots, path: &str) -> Result<(), String> {
    let path = remote.normalize(path)?;
    remote::delete(&remote.host, &path)
}

fn conflict_token(info: &remote::RemoteStat) -> String {
    format!("remote:{}:{}", info.size, info.mtime)
}

/// Move a remote path, mirroring `fs_move`: a conflict is reported with a token
/// the frontend can echo back to approve replacing the destination.
pub fn move_path(
    remote: &RemoteRoots,
    from: &str,
    to: &str,
    expected_conflict: Option<&str>,
) -> Result<FsMoveResult, String> {
    let from = remote.normalize(from)?;
    let to = remote.normalize(to)?;
    if from == to {
        return Ok(FsMoveResult::Moved);
    }
    let Some(from_info) = remote::stat(&remote.host, &from)? else {
        return Err(format!("not found: {from}"));
    };
    if let Some(to_info) = remote::stat(&remote.host, &to)? {
        let replaceable = from_info.kind != RemoteKind::Dir && to_info.kind != RemoteKind::Dir;
        let token = conflict_token(&to_info);
        if !replaceable || expected_conflict != Some(token.as_str()) {
            return Ok(FsMoveResult::Conflict { replaceable, token });
        }
        remote::rename(&remote.host, &from, &to)?;
        return Ok(FsMoveResult::Moved);
    }
    remote::move_no_replace(&remote.host, &from, &to)?;
    Ok(FsMoveResult::Moved)
}

fn join_remote(parent: &str, name: &str) -> String {
    if parent == "/" {
        format!("/{name}")
    } else {
        format!("{}/{name}", parent.trim_end_matches('/'))
    }
}

fn remote_name(path: &str) -> Option<&str> {
    path.rsplit('/').find(|segment| !segment.is_empty())
}

/// Copy remote sources into a remote directory, mirroring `fs_copy`.
pub fn copy(
    remote: &RemoteRoots,
    sources: &[String],
    dest_dir: &str,
    rename_on_conflict: bool,
) -> Result<CopyResult, String> {
    if sources.len() > MAX_COPY_SOURCES {
        return Err(format!("copy at most {MAX_COPY_SOURCES} items at a time"));
    }
    let dest = remote.normalize(dest_dir)?;
    match remote::stat(&remote.host, &dest)? {
        Some(info) if info.kind == RemoteKind::Dir => {}
        Some(_) => return Err("copy destination is not a directory".into()),
        None => return Err(format!("copy destination does not exist: {dest}")),
    }
    let mut result = CopyResult::default();
    for source in sources {
        let failed = |result: &mut CopyResult, message: String| {
            result.failed.push(CopyFailure {
                source: source.clone(),
                message,
            });
        };
        let normalized = match remote.normalize(source) {
            Ok(path) => path,
            Err(error) => {
                failed(&mut result, error);
                continue;
            }
        };
        let Some(name) = remote_name(&normalized).map(str::to_string) else {
            failed(&mut result, "copy source has no filename".to_string());
            continue;
        };
        let mut target = join_remote(&dest, &name);
        if remote::stat(&remote.host, &target)?.is_some() {
            if !rename_on_conflict {
                failed(&mut result, "destination already exists".to_string());
                continue;
            }
            let mut found = None;
            for suffix in 1..=MAX_COPY_SUFFIX {
                let candidate = join_remote(&dest, &format!("{name} copy {suffix}"));
                if remote::stat(&remote.host, &candidate)?.is_none() {
                    found = Some(candidate);
                    break;
                }
            }
            match found {
                Some(candidate) => target = candidate,
                None => {
                    failed(
                        &mut result,
                        "could not find a free destination name".to_string(),
                    );
                    continue;
                }
            }
        }
        match remote::copy(&remote.host, &normalized, &target) {
            Ok(()) => result.created.push(target),
            Err(error) => failed(&mut result, error),
        }
    }
    Ok(result)
}

/// Resolve the `root` a remote mutation must stay inside.
pub fn require_root(remote: &RemoteRoots, root: &str) -> Result<String, String> {
    let root = remote.normalize(root)?;
    Ok(root)
}

/// The root components check: `path` must stay inside `root`.
pub fn require_within(root: &str, path: &str) -> Result<(), String> {
    if paths::remote_contains(root, path) {
        Ok(())
    } else {
        Err(format!("path is outside the authorized workspace: {path}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_posix_paths() {
        assert_eq!(join_remote("/", "a"), "/a");
        assert_eq!(join_remote("/home/me/", "a"), "/home/me/a");
        assert_eq!(remote_name("/home/me/a.txt"), Some("a.txt"));
        assert_eq!(remote_name("/"), None);
    }

    #[test]
    fn conflict_tokens_are_stable_for_one_remote_identity() {
        let info = remote::RemoteStat {
            kind: RemoteKind::File,
            size: 3,
            mtime: 9,
        };
        assert_eq!(conflict_token(&info), "remote:3:9");
    }

    #[test]
    fn within_uses_segment_boundaries() {
        assert!(require_within("/a/b", "/a/b/c").is_ok());
        assert!(require_within("/a/b", "/a/bc").is_err());
    }
}
