# DSH: ACP console and managed Web GUI

This guide elaborates on `TERAX.md`. If anything here conflicts with `TERAX.md`, `TERAX.md` wins.

The DSH console is the `Terax | DSH` switch in the agent window. It talks to the official `@deepseek-ai/dsh` CLI over ACP v1 for automation, and it hosts the CLI's own Web GUI in a dedicated window for everything ACP omits. Neither path reimplements DSH's protocol or its UI.

## Why DSH is not a terminal agent

`src/modules/agents/lib/launcher.ts` starts Claude Code, Codex, Gemini CLI, Pi, OpenCode and Grok as ordinary terminal programs: a PTY tab, OSC 133 C arming, `src-tauri/src/modules/pty/agent_detect.rs` state transitions, and optional lifecycle hooks through `src-tauri/src/modules/agent.rs`. That model needs a terminal UI to host and structured terminal output to detect.

DSH ships no terminal UI. The installed CLI exposes `web`, `acp`, `headless` and `sdk` surfaces, so there is no TUI tab to detect and no byte stream that means "DSH is working". Cloning the DSH UI in React, or translating its internal protocol into Terax messages, would be a second implementation that drifts with every CLI release. Terax therefore hosts DSH's own official UI for the interactive surface and keeps the official ACP profile for programmatic prompts. The console is an agent-window pane, never a PTY tab.

## The retired ACP gateway

Older builds shipped the third-party `dsh-acp-gateway@3.12.0` over ACP stdio. It bundled its own DSH runtime, so it could not follow the installed CLI.

| | Retired | Current |
| --- | --- | --- |
| Default command | `npx -y dsh-acp-gateway@3.12.0` | `dsh --profile acp` |
| Origin | third-party package | official CLI profile |
| DSH runtime | bundled inside the gateway | the installed `@deepseek-ai/dsh` |
| DSH dependency | `@deepseek-ai/dsh ^0.1.2-rc.1` | `0.2.1-rc.2` |
| Last published | 2026-09-04 | tracks the CLI |
| Extra ACP surface | plans, slash commands, elicitation, modes/presets | none |

The gateway is retired: its pinned runtime cannot use current DSH sessions, presets or settings, and its ACP extensions were never part of the standard. `src/modules/settings/store.ts` holds `DEFAULT_DSH_ACP_COMMAND` (`dsh --profile acp`) and `LEGACY_DSH_ACP_COMMAND`; normalization rewrites a stored command that exactly equals the legacy default to the official profile, while any other explicit command is left alone. `dshWebCommand` follows the same shape with its own default, `dsh web --no-open --port 0`; an empty, multiline, oversized or control-character value falls back to it.

## ACP capability matrix

The console is an automation surface, not a DSH UI replacement. `src/modules/ai/dsh/client.ts` initializes ACP v1 with `terminal: false`, `fs.readTextFile/writeTextFile: false` and an empty `plan` capability, so the agent runs its own tools rather than asking the host to run them.

| Capability | Official ACP | Console | Web GUI |
| --- | --- | --- | --- |
| Prompts and streamed message/thought updates | yes | yes | yes |
| Tool call lifecycle | yes | yes | yes |
| Permission requests | yes | yes | yes |
| Model and reasoning config options | yes | yes | yes |
| `session/list`, `session/resume`, `session/close` | yes | yes | yes |
| `session/load` (history replay) | no | no, local transcript instead | DSH store |
| Plan updates | no | no | yes |
| Slash commands | no | no | yes |
| Elicitation forms | no | handled, never requested | yes |
| Modes and presets | no | no | yes |
| Settings and credentials panels | no | no | yes |

`updates.ts` still carries plan and command reducers and `elicitation.ts` still maps an ACP elicitation schema onto form fields; they are dormant under the official profile. Keep them for agents that advertise those extensions, but never render an empty plan or elicitation surface. ACP resume does not replay history, which is why `store.ts` persists bounded transcripts in `terax-ai-dsh.json` and restores the local side of a resumed session.

## Managed `dsh web` sidecar

`src-tauri/src/modules/dsh_web.rs` owns one `dsh web` process per app process.

### Spawn and cwd

`dsh_web_start { command, cwd, workspace }` takes the command from the `dshWebCommand` preference, validates it as a trimmed single line of at most 512 bytes with no control characters, and builds the invocation through the shared `dsh_acp` command builder (platform shell, login-shell `PATH` overlay, AppImage library paths stripped). `cwd` is the active workspace root, authorized through `WorkspaceRegistry` before spawn. Only `WorkspaceEnv::Local` is accepted: a WSL workspace fails closed with an error and no process. Stdin is null; stdout and stderr are piped. The child gets its own process group on Unix (`setpgid`), a kill-on-close Windows Job Object on Windows, and a hidden console window. The command is user-authored and runs with the user's privileges; Terax validates shape, not intent.

### URL capture and boot deadline

`dsh web` prints one line of the form `dsh web: <url>` once its server is listening. The stdout reader splits lines with the ACP `LineSplitter` and accepts the first matching line. The URL must be `http` or `https`, name a loopback host (`localhost`, `::1`, or `127.*`), and yield a port. Anything else is ignored, so a misconfigured or compromised command cannot turn its stdout into a window or browser tab onto a remote page. The final unterminated line is checked at EOF. Boot is capped at 120 seconds because the first run initializes the web profile (15 to 20 seconds observed); on timeout or early exit the process is killed and the error carries the last 40 stderr lines.

### Single instance and lifecycle

`DshWebState` holds a slot in one of `Idle`, `Starting` or `Running`. `dsh_web_start` claims the slot before spawning, so two concurrent starts cannot produce two servers, and it returns the existing status when one is already running. `dsh_web_status` reports `{ port }` or null and demotes a server whose waiter already saw it exit. A waiter thread marks the process exited and emits `terax:dsh-web-changed` with `{ running: false, port: null }`; a successful start emits `{ running: true, port }`.

| Command | Arguments | Returns |
| --- | --- | --- |
| `dsh_web_start` | `{ command, cwd, workspace }` | `{ port }` |
| `dsh_web_status` | none | `{ port }` or null |
| `dsh_web_open` | none | `"window"` or `"browser"` |
| `dsh_web_stop` | none | null |
| `dsh_web_close_all` | none | none (internal, app exit) |

`dsh_web_stop` kills the process group (Unix `SIGKILL` on the group, Windows Job Object plus child kill), waits for it, closes the window and emits the stopped event. `RunEvent::Exit` calls `dsh_web_close_all` because destructors are not guaranteed to run on app exit. The frontend `webStore.ts` adds a module-scoped start promise on top of the Rust guard, so the connection-bar button, the command palette and the Settings block serialize instead of racing.

### Frontend surface

`src/modules/ai/dsh/web.ts` wraps the four commands, exports `DSH_WEB_EVENT` (`terax:dsh-web-changed`) and turns a listener into an unlisten function. `webStore.ts` keeps `idle`, `starting`, `running` and `error`, refreshes once on mount and then follows the event, and exposes `start`, `open`, `stop` and `refresh`. The console's connection bar carries the `Web GUI` button (start when idle, open when running); Settings › Agents › "DSH Web GUI" edits `dshWebCommand` (`dsh web --no-open --port 0` by default, with Reset); the command palette offers "Open DSH Web GUI" and "Stop DSH Web GUI".

## Window, cookie and capability isolation

`dsh_web_open` builds a `tauri::WebviewWindow` labeled `dsh-web` (title `DSH`, 1200x800, minimum 720x480, resizable), parented to `main` for stacking but not embedded, and loads the captured URL as `WebviewUrl::External`. Reopening navigates the existing window, so a restarted server reuses it.

The window is top-level on purpose. DSH mints its session cookie with `SameSite=Strict`. An iframe inside the Terax origin (`tauri://localhost`, `http(s)://tauri.localhost` on Windows, or the dev-server origin) counts as a cross-site frame for the loopback URL, so the browser would never send that cookie and the page could never authenticate. A separate top-level browsing context makes the loopback URL first-party.

The label is absent from `src-tauri/capabilities/default.json`, whose window list is `main` and `settings`. The remote page therefore receives no Tauri IPC, no plugin permission and no window command; it is a normal webview for DSH's own JavaScript and nothing more. This is deliberately stronger than adding a narrow capability: DSH does not need any host API, so it gets none.

If window creation fails, `dsh_web_open` falls back to `tauri-plugin-opener` and returns `"browser"`. The URL, token included, then appears in the system browser's address bar; that is acceptable because the token is one-time and scoped to the loopback server.

## Security and token handling

- The loopback URL embeds a one-time token minted by `dsh web`. It is stored only in `DshWebServer.url` in Rust memory.
- It is never logged. Log lines around the sidecar name exit codes, stderr lines and failures, never the URL.
- It is never persisted: not in the settings store, not on disk, not in `localStorage`.
- It never crosses into the frontend. `dsh_web_status` exposes only the port, and opening the GUI is a command that resolves `"window"` or `"browser"`; the webview cannot construct or read the URL.
- Only loopback URLs are accepted from stdout, so the captured value cannot point at a remote origin.
- The process is bound to the app lifetime, runs in its own group/job, and is killed on stop and on exit.
- A restarted server mints a new token, so an old link stops working. Terax caches nothing to reuse.

The token gates HTTP access to the loopback server. It does not change what the DSH Web GUI itself may do inside `~/.dsh`; that authority belongs to DSH and the OS user.

## Data sharing with manual `dsh web`

Both the managed server and a `dsh web` the user starts by hand use `~/.dsh`, so sessions, presets and settings are shared. A session created in the Terax window is visible to a hand-run instance in the same profile, and vice versa.

DSH allows one writer per session. Opening the same session in both instances makes the second writer fail with `session/writer-held`; the write is refused, the session is not corrupted. Practical rules:

- Do not keep the same session open in the managed window and a manual `dsh web` at once. Finish or close it in one before resuming in the other.
- Stop the managed server (`dsh_web_stop`, the console button, or "Stop DSH Web GUI") before starting a manual `dsh web` that needs exclusive control.
- The single-instance guarantee is per app process. A second Terax process starts its own managed server against the same `~/.dsh`, and the writer rule still applies between them.

## Known limitations

- Plans, slash commands, elicitation, modes/presets and settings exist only in the Web GUI. The console hides them rather than offering controls the official profile cannot answer.
- No `session/load`: ACP resume attaches without replaying history. The console restores its own transcript; the Web GUI relies on DSH's store.
- WSL is unsupported for the Web GUI. The ACP console still spawns in WSL workspaces through `dsh_acp`; only `dsh_web_start` accepts local workspaces and fails closed on anything else.
- No protocol reimplementation: there is no ACP shim for Web-only features and no React clone of the DSH UI. The official CLI is the contract.
- First run is slow: `dsh web` initializes the web profile (15 to 20 seconds observed) inside a 120 second cap. Later boots are faster; the sidecar starts on demand, never at app launch.
- The server is fixed to the workspace root it was started from. Switching workspaces does not restart it; stop and start again to change the root.
- The port is ephemeral (`--port 0`), so there is no stable URL to bookmark. The status reports the port only.
- The Web GUI is DSH's network origin. Terax cannot theme, script or inspect it, and it runs outside the app's IPC boundary by construction.

## How to verify

1. Static boundary: `src-tauri/capabilities/default.json` lists only `main` and `settings`; `WINDOW_LABEL` in `dsh_web.rs` is `dsh-web`; no log statement includes `server.url`.
2. Rust tests: `cd src-tauri && cargo test dsh_web` covers the startup line parser (loopback accepted, remote/foreign lines rejected), starting and stopping a fake `dsh`, and the error for an early exit without a URL.
3. Frontend checks: `pnpm test` covers `normalizeDshWebCommand`; `pnpm check-types` covers the `web.ts` wrappers.
4. Manual: Settings › Agents › "DSH Web GUI" shows `dsh web --no-open --port 0` and Reset. Open the DSH console, click `Web GUI`; the button spins while starting, then the `DSH` window loads. Confirm one `dsh web` process and a listener on a loopback address.
5. Stop from the console button or the "Stop DSH Web GUI" palette entry: the process disappears, the window closes, and the button returns to its start state.
6. Kill the `dsh` process externally: `terax:dsh-web-changed` flips the store to idle and the button offers to start again. Reopening starts a new server with a new URL.
7. Start from a WSL workspace: the command fails with the local-only error and no process is spawned.

## See also

- [`TERAX.md`](../../TERAX.md) - the architecture source of truth
- [AI subsystem](ai-subsystem.md) - providers, agent loop, tools and approval flow
- [Security model](security-model.md) - IPC, network and secret boundaries
- [Two-process model](two-process-model.md) - command catalog and IPC conventions
