# Containerized build environment

The repository ships a Docker image that holds the whole Linux toolchain: Node 24, pnpm, Rust (stable, with clippy/rustfmt/cargo-nextest), the Tauri GTK/WebKit headers and the deb/rpm/AppImage bundler. Compilation happens inside the container; the host only supplies the source tree and receives finished artifacts.

Use it when you do not want to install (or pollute) a host toolchain, when you need a Linux bundle from macOS or Windows, or when you want a build that matches the Linux release runner (Ubuntu 22.04, glibc 2.35).

## Requirements

- Docker Engine or Docker Desktop with BuildKit, plus Compose v2 (`docker compose`).

## Commands

The Compose file defines one service, `dev`. Every command below builds the image on first use and reuses it afterwards:

| Command | What it does |
| --- | --- |
| `docker compose run --rm dev` | Interactive shell with dependencies installed |
| `docker compose run --rm dev frontend-check` | `pnpm lint`, `pnpm check-types`, `pnpm test` |
| `docker compose run --rm dev rust-check` | `cargo clippy --all-targets --locked -- -D warnings` and `cargo nextest run --locked` |
| `docker compose run --rm dev build` | `pnpm build` (tsc + Vite) |
| `docker compose run --rm dev bundle` | Full Linux bundle: `pnpm tauri build`, then copies `*.deb`, `*.rpm` and `*.AppImage` to `./artifacts` |
| `docker compose run --rm dev install --force` | Force `pnpm install --frozen-lockfile` |

Anything that is not one of the tasks above is executed as-is, so the container also works as a plain command runner:

```sh
docker compose run --rm dev cargo test --locked -p terax-control-protocol
docker compose run --rm dev pnpm vitest run src/modules/terminal
docker compose run --rm dev bash -lc 'cd src-tauri && cargo fmt --check'
```

## What stays off the host

The source tree is bind-mounted at `/workspace`, but every toolchain directory is a named volume, so nothing is compiled into the working tree:

| Volume | Mount | Contents |
| --- | --- | --- |
| `node_modules` | `/workspace/node_modules` | pnpm virtual store and installed packages |
| `cargo_target` | `/workspace/src-tauri/target` | Rust build artifacts |
| `cargo_registry`, `cargo_git` | `/usr/local/cargo/{registry,git}` | Downloaded crates, reused across runs |
| `tauri_gen` | `/workspace/src-tauri/gen` | Tauri-generated capability schemas |
| `tauri_binaries` | `/workspace/src-tauri/binaries` | Generated `terax-cli` sidecar |
| `pnpm_store` | `/workspace/.pnpm-store` | pnpm content-addressable store |

`./artifacts` is the only path the container writes into the working tree (plus `dist/` when you run the `build` task).

Reset the caches with `docker compose down --volumes`, or a single one with `docker volume rm terax-build_cargo_target`.

## Platform notes

- On Apple Silicon the image builds `linux/arm64` bundles. For an `x86_64` bundle (what the release publishes for `ubuntu-22.04`), build under emulation:

  ```sh
  DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose run --rm dev bundle
  ```

  Emulated builds are substantially slower, especially the LTO release profile.

- Only Linux bundles can be produced here. macOS and Windows installers need their native SDKs.
- `pnpm tauri dev` needs a display and is not supported inside the container; run the desktop app on the host and use the container for checks and packaging.

## Signing

`bundle` disables `createUpdaterArtifacts`, because signed updater artifacts require `TAURI_SIGNING_PRIVATE_KEY`. Export that variable (and its password) before running the task to sign them:

```sh
TAURI_SIGNING_PRIVATE_KEY=... TAURI_SIGNING_PRIVATE_KEY_PASSWORD=... \
  docker compose run --rm -e TAURI_SIGNING_PRIVATE_KEY -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD dev bundle
```
