# SSH remote workspaces

A remote workspace moves the files and processes Terax works on to one SSH
host while the app, the AI providers and the OS keychain stay here. It is the
Remote-SSH shape: choose a host, open a folder that lives there, and the
explorer, editor, terminals and the agent's shell all act on that machine.

`TERAX.md` holds the architecture source of truth; this guide explains the SSH
transport, its security decisions and what is deliberately not implemented yet.

## Why the system OpenSSH client

The transport shells out to the user's `ssh`, exactly as VS Code does, instead
of linking an SSH implementation:

- `~/.ssh/config` aliases, `ProxyJump`, `Match` blocks, `ssh-agent`, hardware
  keys, passwords and one-time codes all keep working without Terax
  reimplementing them.
- `known_hosts` verification stays OpenSSH's. Terax never writes its own
  `known_hosts` parser and never relaxes host-key checking.
- No crypto stack is added to a 7-8 MB binary; `ssh2` would pull libssh2 and a
  second TLS stack, `russh` would mean re-implementing `portable-pty`'s master
  traits and duplicating host-key policy.

Two invocation shapes exist:

| Shape | Used by | Notes |
|---|---|---|
| `ssh -tt … -- <host> '<cd> && exec $SHELL -l'` | interactive terminal tabs | The client runs inside the existing `portable-pty` session, so resize (`window-change`), flow control, exit frames and the reader filters are unchanged. |
| `ssh -T -o BatchMode=yes … -- <host> 'sh -c <script>'` | remote filesystem, probes, agent shell | Bounded through `proc::capture` (output caps, timeouts, truncation). On Unix a `ControlMaster=auto` socket under the app cache multiplexes these calls over one connection; Windows has no ControlMaster, so each call owns a connection. |

The binary is resolved from `TERAX_SSH_BIN`, then the platform's usual
locations, then `which::which("ssh")`. On Windows the OpenSSH Client optional
feature must be installed; the missing case is reported as `missing-binary`
rather than being retried as a generic failure.

## Host records and authorization

Hosts live in `<app config dir>/ssh-hosts.json`, written atomically
(temp file in the same directory, then rename) with `0600` on POSIX. A record
carries an id, a display label, a target (hostname, address or config alias),
an optional port, user, identity file, default remote directory and remote
shell. **No secret is stored**: authentication belongs to OpenSSH, and the app
keychain is not involved.

A remote path is only served after its root was authorized for that host:

- a successful probe authorizes the remote `$HOME`;
- opening a remote space authorizes the chosen folder (`ssh_authorize_root`
  canonicalizes it on the remote side first);
- every command normalizes the requested POSIX path lexically (`..` cannot
  climb above `/`), then requires it to be inside an authorized root.

Local paths and remote paths have separate authorization stores. A remote path
is never canonicalized on the host, and the local `WorkspaceRegistry` is not
consulted for remote roots.

## Wire protocol

One POSIX script per operation. User data (paths, names) is embedded as base64
literals, so a path can never become shell syntax; file contents travel base64
over stdin/stdout. The reply is line based:

```text
TERAX_OK\n<field>\t<field>…
```

or

```text
TERAX_ERR\t<CODE>\t<base64 message>
```

Strict parsing matters: a remote login script that prints a banner, or a
command that dies before the header, produces a transport error instead of a
half-parsed result. `TERAX_OK` output caps are 8 MiB for a directory listing,
16 MiB for a file read and 64 KiB for metadata; `stat`/`base64`/`dirname` are
probed once per host and a missing tool fails the probe with an actionable
message.

Writes stage into a sibling temp file in the same remote directory, optionally
check the previously observed mtime, copy the original mode, then rename over
the target. Moves distinguish replace (rename) from no-replace (move) the same
way the local commands do; copies refuse to overwrite and use `cp -R -P` so
symlinks are preserved without being followed.

## What runs remotely today

| Surface | Status |
|---|---|
| Terminal tabs | Remote login shell at the space folder (`ssh -tt`, per-tab connection). |
| Explorer (list, create, rename, move, delete, copy) | Remote, gated by the authorized root. |
| Editor (open, save, mtime conflict detection) | Remote; files up to 10 MiB. |
| AI file tools (`read_file`, `list_directory`, `write_file`, `edit`, …) | Follow the workspace env; remote reads/writes use the same backend. |
| AI shell tools (`bash_run`) and one-shot shell commands | `ssh -- sh -lc`, with the Host keeping the cwd state as before. |
| Host manager, remote spaces, status pill, command palette | Settings › Remote SSH plus the space dialog and palette entries. |

The explorer is rooted at the active space's folder — the cwd of its terminals
when one has run, otherwise the remote `$HOME`. The local launch directory is
never used as a fallback for a remote space: it is this machine's path and the
transport would reject it as unauthorized (a tab from another space or the
bootstrap tab must not leak one either). Files opened outside an authorized
root are refused with the same message the backend returns.

## What is deliberately not implemented yet

These fail closed with `… is not available for SSH remote workspaces yet`
instead of silently acting on the local machine:

- source control (git status/diff/commit, worktrees, checkpoints),
- search/grep/glob, the file index and native file watchers,
- language servers and external formatters (they spawn local processes),
- asset grants for previews (images, markdown assets),
- background shells (`bash_background`),
- remote shell-integration scripts, so block view and cwd breadcrumbs depend
  on the remote shell's own OSC 7/133 output,
- persistent remote helper / SFTP batching, port forwarding, multi-hop beyond
  what `~/.ssh/config` already does.

## Testing

- Unit tests cover host validation and persistence, argv construction, shell
  quoting, remote path normalization/containment, script generation (no user
  bytes reach the script as syntax) and the fail-closed guards.
- `src-tauri/tests/ssh_remote.rs` runs the real scripts end to end against a
  fake `ssh` client that emulates OpenSSH's argument shape and executes the
  remote command with the local `sh`: listing, binary round trips, atomic
  writes, create/rename/move/delete/copy, conflict tokens and unauthorized
  paths. It needs no network and runs on every Unix CI.
- A real-host lane is manual: add a host from `~/.ssh/config`, probe it, open a
  remote space, then verify explorer/editor/terminal/`bash_run` and confirm an
  unsupported surface reports the message above.
