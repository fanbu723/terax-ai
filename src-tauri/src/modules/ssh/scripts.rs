//! POSIX shell scripts the SSH transport runs on the remote host.
//!
//! Every user-supplied value is embedded as a base64 literal, so a remote path
//! can never become shell syntax. Each script answers on stdout with a protocol
//! the caller parses strictly:
//!
//! ```text
//! TERAX_OK[\t<field>...]\n
//! <payload lines>
//! ```
//!
//! or
//!
//! ```text
//! TERAX_ERR\t<CODE>\t<base64 message>\n
//! ```
//!
//! A command that fails before printing a header (missing `base64`, a broken
//! login script that pollutes stdout) is rejected by the parser instead of
//! being mistaken for a result.

use super::encoding;

/// Shared helpers: base64 decode (GNU/BSD spelling), base64 encode, `stat`
/// size+mtime (GNU/BSD spelling) and the two protocol printers.
const PREAMBLE: &str = r#"LC_ALL=C; export LC_ALL
if printf 'aGk=' | base64 -d >/dev/null 2>&1; then tb64d() { base64 -d; }; else tb64d() { base64 -D; }; fi
tb64e() { printf '%s' "$1" | base64 | tr -d '\n'; }
tstat() { if stat -c '%s|%Y' / >/dev/null 2>&1; then stat -c '%s|%Y' -- "$1" 2>/dev/null; else stat -f '%z|%m' -- "$1" 2>/dev/null; fi; }
terr() { printf 'TERAX_ERR\t%s\t%s\n' "$1" "$(tb64e "$2")"; exit 0; }
tok() { printf 'TERAX_OK%s\n' "$1"; }
"#;

/// A base64 of `value` as a single-quoted shell literal. The base64 alphabet
/// contains no quote, newline or backslash, so the literal needs no escaping.
fn literal(value: &str) -> String {
    format!("'{}'", encoding::encode(value.as_bytes()))
}

fn script(body: String) -> String {
    format!("{PREAMBLE}{body}")
}

/// Verify the POSIX tools the transport needs and print the remote `$HOME`.
pub fn probe_home() -> String {
    script(
        r#"command -v base64 >/dev/null 2>&1 || terr MISSING 'base64 is required on the remote host'
command -v stat >/dev/null 2>&1 || terr MISSING 'stat is required on the remote host'
command -v dirname >/dev/null 2>&1 || terr MISSING 'dirname is required on the remote host'
printf 'TERAX_OK\n%s\n' "$HOME"
"#
        .to_string(),
    )
}

/// `stat` one path.
pub fn stat(path: &str) -> String {
    script(format!(
        r#"p=$(printf %s {path} | tb64d) || terr IO 'path decode failed'
if [ ! -e "$p" ] && [ ! -L "$p" ]; then terr NOTFOUND "no such file or directory: $p"; fi
if [ -L "$p" ]; then k=symlink; elif [ -d "$p" ]; then k=dir; else k=file; fi
info=$(tstat "$p") || terr IO "cannot stat: $p"
printf 'TERAX_OK\n%s\t%s\n' "$k" "$info"
"#,
        path = literal(path)
    ))
}

/// List one directory: `base64(name)\tkind\tsize\tmtime` per entry.
pub fn list(dir: &str) -> String {
    script(format!(
        r#"p=$(printf %s {dir} | tb64d) || terr IO 'path decode failed'
[ -d "$p" ] || terr NOTDIR "not a directory: $p"
printf 'TERAX_OK\n'
for e in "$p"/* "$p"/.[!.]* "$p"/..?*; do
  if [ ! -e "$e" ] && [ ! -L "$e" ]; then continue; fi
  if [ -L "$e" ]; then k=symlink; elif [ -d "$e" ]; then k=dir; else k=file; fi
  info=$(tstat "$e"); s=${{info%%|*}}; m=${{info##*|}}
  printf '%s\t%s\t%s\t%s\n' "$(tb64e "${{e##*/}}")" "$k" "${{s:-0}}" "${{m:-0}}"
done
"#,
        dir = literal(dir)
    ))
}

/// Read a file as base64, refusing anything above `max_bytes`.
pub fn read(path: &str, max_bytes: u64) -> String {
    script(format!(
        r#"p=$(printf %s {path} | tb64d) || terr IO 'path decode failed'
[ -f "$p" ] || terr NOTFILE "not a regular file: $p"
info=$(tstat "$p") || terr IO "cannot stat: $p"
s=${{info%%|*}}; m=${{info##*|}}
[ -n "$s" ] || terr IO "cannot read size: $p"
[ "$s" -le {max_bytes} ] || terr TOOLARGE "$s"
printf 'TERAX_OK\n%s\n' "$m"
base64 < "$p"
"#,
        path = literal(path),
        max_bytes = max_bytes
    ))
}

/// Write stdin (base64) to `path` atomically, optionally guarded by the mtime
/// the caller last observed.
pub fn write(path: &str, expected_mtime: Option<u64>) -> String {
    let guard = match expected_mtime {
        Some(mtime) => format!(
            r#"if [ -e "$p" ]; then
  info=$(tstat "$p"); bm=${{info##*|}}
  [ "$bm" = '{mtime}' ] || terr STALE "file changed on disk: $p"
fi
"#
        ),
        None => String::new(),
    };
    script(format!(
        r#"p=$(printf %s {path} | tb64d) || terr IO 'path decode failed'
d=$(dirname -- "$p") || terr IO "cannot resolve parent: $p"
[ -d "$d" ] || terr NOTDIR "not a directory: $d"
tmp="$d/.terax-write.$$"
mode=''
if [ -e "$p" ]; then
  if stat -c '%a' -- "$p" >/dev/null 2>&1; then mode=$(stat -c '%a' -- "$p" 2>/dev/null); else mode=$(stat -f '%Lp' -- "$p" 2>/dev/null); fi
  {guard}fi
tb64d > "$tmp" || {{ rm -f "$tmp"; terr IO "cannot write: $p"; }}
if [ -n "$mode" ]; then chmod "$mode" "$tmp" 2>/dev/null; fi
mv -f -- "$tmp" "$p" || {{ rm -f "$tmp"; terr IO "cannot replace: $p"; }}
info=$(tstat "$p") || terr IO "cannot stat after write: $p"
printf 'TERAX_OK\n%s\n' "${{info##*|}}"
"#,
        path = literal(path),
        guard = guard
    ))
}

/// Create one directory (or the whole chain).
pub fn mkdir(path: &str, recursive: bool) -> String {
    let args = if recursive { "-p" } else { "" };
    script(format!(
        r#"p=$(printf %s {path} | tb64d) || terr IO 'path decode failed'
if [ -e "$p" ] || [ -L "$p" ]; then terr CONFLICT "already exists: $p"; fi
mkdir {args} -- "$p" 2>/dev/null || terr IO "cannot create directory: $p"
printf 'TERAX_OK\n'
"#,
        path = literal(path),
        args = args
    ))
}

/// Create an empty file, failing when the path already exists.
pub fn create_file(path: &str) -> String {
    script(format!(
        r#"p=$(printf %s {path} | tb64d) || terr IO 'path decode failed'
if [ -e "$p" ] || [ -L "$p" ]; then terr CONFLICT "already exists: $p"; fi
d=$(dirname -- "$p") || terr IO "cannot resolve parent: $p"
[ -d "$d" ] || terr NOTDIR "not a directory: $d"
: > "$p" 2>/dev/null || terr IO "cannot create file: $p"
printf 'TERAX_OK\n'
"#,
        path = literal(path)
    ))
}

/// Rename/replace a path (the local `fs_rename` semantics).
pub fn rename(from: &str, to: &str) -> String {
    script(format!(
        r#"a=$(printf %s {from} | tb64d) || terr IO 'path decode failed'
b=$(printf %s {to} | tb64d) || terr IO 'path decode failed'
if [ ! -e "$a" ] && [ ! -L "$a" ]; then terr NOTFOUND "no such file or directory: $a"; fi
mv -f -- "$a" "$b" 2>/dev/null || terr IO "cannot rename: $a"
printf 'TERAX_OK\n'
"#,
        from = literal(from),
        to = literal(to)
    ))
}

/// Move a path without replacing an existing destination (`fs_move`).
pub fn move_no_replace(from: &str, to: &str) -> String {
    script(format!(
        r#"a=$(printf %s {from} | tb64d) || terr IO 'path decode failed'
b=$(printf %s {to} | tb64d) || terr IO 'path decode failed'
if [ ! -e "$a" ] && [ ! -L "$a" ]; then terr NOTFOUND "no such file or directory: $a"; fi
if [ -e "$b" ] || [ -L "$b" ]; then terr CONFLICT "already exists: $b"; fi
mv -- "$a" "$b" 2>/dev/null || terr IO "cannot move: $a"
printf 'TERAX_OK\n'
"#,
        from = literal(from),
        to = literal(to)
    ))
}

/// Remove a path recursively, like `fs_delete`.
pub fn remove(path: &str) -> String {
    script(format!(
        r#"p=$(printf %s {path} | tb64d) || terr IO 'path decode failed'
if [ ! -e "$p" ] && [ ! -L "$p" ]; then terr NOTFOUND "no such file or directory: $p"; fi
rm -rf -- "$p" 2>/dev/null || terr IO "cannot delete: $p"
printf 'TERAX_OK\n'
"#,
        path = literal(path)
    ))
}

/// Copy a path recursively without following symlinks, refusing to overwrite.
pub fn copy(from: &str, to: &str) -> String {
    script(format!(
        r#"a=$(printf %s {from} | tb64d) || terr IO 'path decode failed'
b=$(printf %s {to} | tb64d) || terr IO 'path decode failed'
if [ ! -e "$a" ] && [ ! -L "$a" ]; then terr NOTFOUND "no such file or directory: $a"; fi
if [ -e "$b" ] || [ -L "$b" ]; then terr CONFLICT "already exists: $b"; fi
cp -R -P -- "$a" "$b" 2>/dev/null || terr IO "cannot copy: $a"
printf 'TERAX_OK\n'
"#,
        from = literal(from),
        to = literal(to)
    ))
}

/// Canonical path of an existing remote path.
pub fn realpath(path: &str) -> String {
    script(format!(
        r#"p=$(printf %s {path} | tb64d) || terr IO 'path decode failed'
if [ ! -e "$p" ] && [ ! -L "$p" ]; then terr NOTFOUND "no such file or directory: $p"; fi
if [ -d "$p" ]; then
  r=$(cd -P -- "$p" 2>/dev/null && pwd -P) || terr IO "cannot canonicalize: $p"
else
  d=$(dirname -- "$p") || terr IO "cannot canonicalize: $p"
  root=$(cd -P -- "$d" 2>/dev/null && pwd -P) || terr IO "cannot canonicalize: $p"
  r="$root/$(basename -- "$p")"
fi
printf 'TERAX_OK\n%s\n' "$r"
"#,
        path = literal(path)
    ))
}

/// Confirm an existing remote directory.
pub fn require_dir(path: &str) -> String {
    script(format!(
        r#"p=$(printf %s {path} | tb64d) || terr IO 'path decode failed'
[ -d "$p" ] || terr NOTDIR "not a directory: $p"
printf 'TERAX_OK\n'
"#,
        path = literal(path)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_values_never_reach_the_script_as_syntax() {
        let hostile = "/tmp/x'; rm -rf / #' $(id) `id` \"";
        for body in [
            stat(hostile),
            list(hostile),
            read(hostile, 1024),
            write(hostile, Some(7)),
            mkdir(hostile, true),
            remove(hostile),
            realpath(hostile),
            require_dir(hostile),
        ] {
            assert!(!body.contains("rm -rf /"), "user path leaked: {body}");
            assert!(body.contains(&encoding::encode(hostile.as_bytes())));
        }
    }

    #[test]
    fn preamble_has_no_expansion_of_the_embedded_literal() {
        let body = stat("/a b");
        let expected = encoding::encode(b"/a b");
        assert!(body.contains(&format!("printf %s '{expected}' | tb64d")));
    }

    #[test]
    fn write_embeds_the_expected_mtime_as_a_compared_literal() {
        assert!(write("/a", Some(1_700_000_000_123)).contains("= '1700000000123'"));
        assert!(!write("/a", None).contains("STALE"));
    }
}
