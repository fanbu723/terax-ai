//! Lexical handling of remote POSIX paths.
//!
//! A remote path is a spelling for a filesystem on another machine: it can be
//! normalized lexically, but it must never be canonicalized or opened locally.
//! Containment checks compare the normalized spellings, so `..` cannot smuggle
//! a path out of an authorized remote root without a round trip.

use crate::modules::workspace::validate_remote_path;

/// Normalize a remote POSIX path lexically: collapse repeated separators,
/// drop `.` segments, and resolve `..` without escaping the root.
///
/// The result has no trailing slash except for `/` itself. A path that tries to
/// climb above `/` is rejected instead of clamped, because the caller asked for
/// something that can only be a mistake or an attack.
pub fn normalize_remote_path(path: &str) -> Result<String, String> {
    validate_remote_path(path)?;
    let mut segments: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => continue,
            ".." => {
                if segments.pop().is_none() {
                    return Err(format!("remote path escapes the root: {path}"));
                }
            }
            other => segments.push(other),
        }
    }
    if segments.is_empty() {
        return Ok("/".to_string());
    }
    Ok(format!("/{}", segments.join("/")))
}

/// Whether `path` is `root` or a descendant of it, comparing normalized forms.
///
/// Both arguments must already be normalized; callers go through
/// [`normalize_remote_path`] so a raw `..` can never pass this check.
pub fn remote_contains(root: &str, path: &str) -> bool {
    if root == "/" {
        return path.starts_with('/');
    }
    path == root
        || path
            .strip_prefix(root)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// The parent directory of a normalized remote path, or `/` at the root.
pub fn remote_parent(path: &str) -> String {
    match path.rfind('/') {
        Some(0) | None => "/".to_string(),
        Some(index) => path[..index].to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_lexically() {
        assert_eq!(normalize_remote_path("/").unwrap(), "/");
        assert_eq!(
            normalize_remote_path("/home/u/project/").unwrap(),
            "/home/u/project"
        );
        assert_eq!(
            normalize_remote_path("/home//u/./project").unwrap(),
            "/home/u/project"
        );
        assert_eq!(
            normalize_remote_path("/home/u/a/../b").unwrap(),
            "/home/u/b"
        );
        assert_eq!(normalize_remote_path("/home/u/a/..").unwrap(), "/home/u");
        assert!(normalize_remote_path("/..")
            .unwrap_err()
            .contains("escapes"));
        assert!(normalize_remote_path("/a/../../b")
            .unwrap_err()
            .contains("escapes"));
    }

    #[test]
    fn rejects_non_absolute_and_control_bytes() {
        assert!(normalize_remote_path("").is_err());
        assert!(normalize_remote_path("home/u").is_err());
        assert!(normalize_remote_path("/home/u\nrm -rf").is_err());
        assert!(normalize_remote_path("/home/\0u").is_err());
    }

    #[test]
    fn containment_respects_segment_boundaries() {
        assert!(remote_contains("/home/u", "/home/u"));
        assert!(remote_contains("/home/u", "/home/u/project"));
        assert!(remote_contains("/", "/anything"));
        assert!(!remote_contains("/home/u", "/home/ursula"));
        assert!(!remote_contains("/home/u", "/home"));
        // Containment compares normalized spellings, so the escape is
        // resolved before the check rather than prefix-matched.
        let escaped = normalize_remote_path("/home/u/../secret").unwrap();
        assert_eq!(escaped, "/home/secret");
        assert!(!remote_contains("/home/u", &escaped));
    }

    #[test]
    fn parent_walks_to_root() {
        assert_eq!(remote_parent("/a"), "/");
        assert_eq!(remote_parent("/a/b"), "/a");
        assert_eq!(remote_parent("/"), "/");
    }
}
