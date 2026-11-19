//! End-to-end coverage of the SSH transport against a fake `ssh` client.
//!
//! The fake client emulates the OpenSSH argument shape and runs the remote
//! command with the local `sh`, so the scripts, the protocol parser, the path
//! guards and the atomic write path are exercised for real without a network.
//! A real-host lane is documented in `docs/architecture/remote-ssh.md`.

#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use terax_lib::modules::ssh::fs as remote;
use terax_lib::modules::ssh::hosts::SshHost;
use terax_lib::modules::ssh::route;
use terax_lib::modules::ssh::RemoteRoots;

/// A fake OpenSSH client: consume the option block, skip the target, then run
/// the joined remote command with the local `sh`.
const FAKE_SSH: &str = r#"#!/bin/sh
while [ $# -gt 0 ]; do
  case "$1" in
    -o|-p|-l|-i) shift 2 ;;
    -T|-tt) shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done
host=$1; shift
exec sh -c "$*"
"#;

fn fake_ssh() -> &'static Path {
    static BIN: OnceLock<PathBuf> = OnceLock::new();
    BIN.get_or_init(|| {
        let dir = std::env::temp_dir().join(format!("terax-fake-ssh-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("fake ssh dir");
        let path = dir.join("ssh");
        std::fs::write(&path, FAKE_SSH).expect("write fake ssh");
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("chmod fake ssh");
        // SAFETY: the fake client is installed once before any transport call
        // in this test binary.
        std::env::set_var("TERAX_SSH_BIN", &path);
        path
    })
}

fn host() -> SshHost {
    SshHost {
        id: "ssh-test".into(),
        label: "Fake".into(),
        host: "fake".into(),
        port: None,
        user: None,
        identity_file: None,
        default_dir: None,
        remote_shell: Some("/bin/sh".into()),
    }
}

fn roots(root: &Path) -> RemoteRoots {
    let root = root.to_string_lossy().to_string();
    RemoteRoots::new(host(), vec![root])
}

fn fixture() -> (tempfile::TempDir, RemoteRoots) {
    fake_ssh();
    let dir = tempfile::tempdir().expect("tempdir");
    let remote = roots(dir.path());
    (dir, remote)
}

#[test]
fn lists_stats_reads_and_writes_remote_paths() {
    let (dir, remote) = fixture();
    std::fs::write(dir.path().join("hello.txt"), "hi\n").unwrap();
    std::fs::create_dir(dir.path().join("nested")).unwrap();
    std::fs::write(dir.path().join("nested/inside.txt"), "x").unwrap();
    std::fs::write(dir.path().join(".hidden"), "h").unwrap();

    let entries = route::read_dir(&remote, dir.path().to_str().unwrap(), false).unwrap();
    let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["nested", "hello.txt"],
        "dirs first, hidden filtered"
    );
    assert!(entries[0].kind == terax_lib::modules::fs::tree::EntryKind::Dir);

    let all = route::read_dir(&remote, dir.path().to_str().unwrap(), true).unwrap();
    assert!(all.iter().any(|entry| entry.name == ".hidden"));

    let stat = route::stat(&remote, dir.path().join("hello.txt").to_str().unwrap())
        .unwrap()
        .expect("file stat");
    assert_eq!(stat.size, 3);
    assert!(stat.mtime > 0);

    let read = route::read_file(
        &remote,
        dir.path().join("hello.txt").to_str().unwrap(),
        false,
    )
    .unwrap();
    match read {
        terax_lib::modules::fs::file::ReadResult::Text { content, .. } => {
            assert_eq!(content, "hi\n")
        }
        other => panic!("expected text, got {other:?}"),
    }

    let target = dir.path().join("written.txt");
    let mtime = route::write_file(&remote, target.to_str().unwrap(), "content").unwrap();
    assert!(mtime > 0);
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "content");
    // A new remote file gets the shell's umask-derived mode, never executable.
    use std::os::unix::fs::PermissionsExt;
    let mode = std::fs::metadata(&target).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode & 0o600, 0o600);
    assert_eq!(mode & 0o111, 0);

    let canonical =
        route::canonicalize(&remote, dir.path().join("nested").to_str().unwrap()).unwrap();
    assert!(canonical.ends_with("/nested"));
}

#[test]
fn writes_roundtrip_binary_content() {
    let (dir, remote) = fixture();
    let bytes: Vec<u8> = (0..=255u8).collect();
    std::fs::write(dir.path().join("blob.bin"), &bytes).unwrap();
    let read = route::read_file(
        &remote,
        dir.path().join("blob.bin").to_str().unwrap(),
        false,
    )
    .unwrap();
    match read {
        terax_lib::modules::fs::file::ReadResult::Binary { size } => {
            assert_eq!(size, bytes.len() as u64)
        }
        other => panic!("expected binary, got {other:?}"),
    }
}

#[test]
fn missing_paths_and_non_files_are_reported() {
    let (dir, remote) = fixture();
    let missing = dir.path().join("nope.txt");
    assert!(route::stat(&remote, missing.to_str().unwrap())
        .unwrap()
        .is_none());
    let error = route::read_file(&remote, missing.to_str().unwrap(), false).unwrap_err();
    assert!(error.contains("no such file or directory"), "{error}");
    let error = route::read_file(&remote, dir.path().to_str().unwrap(), false).unwrap_err();
    assert!(error.contains("regular files"), "{error}");
}

#[test]
fn mutations_create_rename_move_delete_and_copy() {
    let (dir, remote) = fixture();
    let root = dir.path().to_str().unwrap().to_string();

    let file = dir.path().join("a.txt");
    route::create_file(&remote, file.to_str().unwrap()).unwrap();
    assert!(file.exists());
    assert!(route::create_file(&remote, file.to_str().unwrap()).is_err());

    let folder = dir.path().join("folder");
    route::create_dir(&remote, folder.to_str().unwrap()).unwrap();
    assert!(folder.is_dir());

    let renamed = dir.path().join("b.txt");
    route::rename(&remote, file.to_str().unwrap(), renamed.to_str().unwrap()).unwrap();
    assert!(renamed.exists() && !file.exists());

    let copied = dir.path().join("folder/b.txt");
    let result = route::copy(
        &remote,
        &[renamed.to_string_lossy().into_owned()],
        folder.to_str().unwrap(),
        false,
    )
    .unwrap();
    assert_eq!(result.created.len(), 1);
    assert!(copied.exists());
    // A second copy without rename-on-conflict fails per item, not the batch.
    let again = route::copy(
        &remote,
        &[renamed.to_string_lossy().into_owned()],
        folder.to_str().unwrap(),
        false,
    )
    .unwrap();
    assert_eq!(again.failed.len(), 1);
    let renamed_copy = route::copy(
        &remote,
        &[renamed.to_string_lossy().into_owned()],
        folder.to_str().unwrap(),
        true,
    )
    .unwrap();
    assert_eq!(renamed_copy.created.len(), 1);
    assert!(dir.path().join("folder/b.txt copy 1").exists());

    let moved = dir.path().join("folder/moved.txt");
    let outcome = route::move_path(
        &remote,
        &copied.to_string_lossy(),
        &moved.to_string_lossy(),
        None,
    )
    .unwrap();
    assert_eq!(outcome, terax_lib::modules::fs::mutate::FsMoveResult::Moved);
    assert!(moved.exists());

    // A conflict reports a token that the same call can echo back.
    let clash = dir.path().join("clash.txt");
    std::fs::write(&clash, "old").unwrap();
    let conflict = route::move_path(
        &remote,
        &moved.to_string_lossy(),
        &clash.to_string_lossy(),
        None,
    )
    .unwrap();
    let terax_lib::modules::fs::mutate::FsMoveResult::Conflict { token, replaceable } = conflict
    else {
        panic!("expected a conflict");
    };
    assert!(replaceable);
    let replaced = route::move_path(
        &remote,
        &moved.to_string_lossy(),
        &clash.to_string_lossy(),
        Some(&token),
    )
    .unwrap();
    assert_eq!(
        replaced,
        terax_lib::modules::fs::mutate::FsMoveResult::Moved
    );
    assert!(!moved.exists());

    route::delete(&remote, &clash.to_string_lossy()).unwrap();
    assert!(!clash.exists());
    route::delete(&remote, folder.to_str().unwrap()).unwrap();
    assert!(!folder.exists());

    assert!(route::require_within(&root, &format!("{root}/x")).is_ok());
    assert!(route::require_within(&root, &format!("{root}-evil")).is_err());
}

#[test]
fn paths_outside_authorized_roots_fail_closed() {
    let (dir, remote) = fixture();
    let outside = dir.path().parent().unwrap().join("elsewhere");
    let error = route::stat(&remote, outside.to_str().unwrap()).unwrap_err();
    assert!(
        error.contains("outside the authorized SSH workspace"),
        "{error}"
    );
    assert!(route::read_dir(&remote, "/", false).is_err());
    assert!(route::write_file(&remote, "/etc/passwd", "x").is_err());
}

#[test]
fn remote_home_and_probe_tools_are_reported() {
    let (dir, remote) = fixture();
    let home = remote::home(&remote.host).unwrap();
    assert!(home.starts_with('/'));
    // The fake client runs the same shell, so the probe validates the scripts.
    let listed = remote::list(&remote.host, dir.path().to_str().unwrap()).unwrap();
    assert!(listed.is_empty());
}

/// Real-host lane, ignored by default so CI needs no credentials:
/// `TERAX_REAL_SSH_HOST=<alias> cargo test --test ssh_remote -- --ignored real_ssh`
///
/// The alias must exist in `~/.ssh/config` (or be a plain address) and must
/// authenticate non-interactively (`BatchMode`), because the smoke run is
/// unattended. Everything it creates lives in one remote temp directory that is
/// removed at the end.
#[test]
#[ignore = "requires a reachable SSH host configured by the caller"]
fn real_ssh_host_roundtrip() {
    let alias = std::env::var("TERAX_REAL_SSH_HOST")
        .expect("set TERAX_REAL_SSH_HOST to run the real-host lane");
    let host = SshHost {
        id: "ssh-real".into(),
        label: "Real".into(),
        host: alias.clone(),
        port: None,
        user: None,
        identity_file: None,
        default_dir: None,
        remote_shell: None,
    };

    let home = remote::home(&host).expect("remote home");
    assert!(home.starts_with('/'), "home {home}");

    let dir = format!("/tmp/terax-ssh-smoke-{}", std::process::id());
    remote::create_dir(&host, &dir, true).expect("create temp dir");
    let remote_roots = RemoteRoots::new(host.clone(), vec![dir.clone()]);

    let file = format!("{dir}/hello.txt");
    let mtime = route::write_file(&remote_roots, &file, "hello from terax").expect("write");
    assert!(mtime > 0);

    let read = route::read_file(&remote_roots, &file, false).expect("read");
    match read {
        terax_lib::modules::fs::file::ReadResult::Text { content, .. } => {
            assert_eq!(content, "hello from terax")
        }
        other => panic!("expected text, got {other:?}"),
    }

    let entries = route::read_dir(&remote_roots, &dir, false).expect("list");
    assert!(entries.iter().any(|entry| entry.name == "hello.txt"));

    let moved = format!("{dir}/renamed.txt");
    route::rename(&remote_roots, &file, &moved).expect("rename");
    assert!(route::stat(&remote_roots, &moved).expect("stat").is_some());

    route::delete(&remote_roots, &moved).expect("delete");
    route::delete(&remote_roots, &dir).expect("delete temp dir");
}
