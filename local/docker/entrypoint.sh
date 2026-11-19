#!/usr/bin/env bash
# Entrypoint for the Terax build container.
#
# Named tasks cover the routine workflows; anything unrecognised is executed
# as-is, e.g. `docker compose run --rm dev cargo --version`.

set -euo pipefail

cd /workspace

node_modules_ready() {
    [ -f node_modules/.modules.yaml ] \
        && [ ! pnpm-lock.yaml -nt node_modules/.modules.yaml ] \
        && [ ! package.json -nt node_modules/.modules.yaml ]
}

ensure_node_modules() {
    if node_modules_ready; then
        return
    fi
    echo "==> pnpm install --frozen-lockfile"
    pnpm install --frozen-lockfile
}

copy_bundles() {
    local bundle_dir=src-tauri/target/release/bundle
    [ -d "$bundle_dir" ] || return 0
    mkdir -p artifacts
    find "$bundle_dir" -maxdepth 2 -type f \
        \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \) \
        -exec cp -v {} artifacts/ \;
}

task="${1:-shell}"
if [ $# -gt 0 ]; then
    shift
fi

case "$task" in
    shell)
        ensure_node_modules
        exec bash "$@"
        ;;
    install)
        pnpm install --frozen-lockfile
        ;;
    lint)
        ensure_node_modules
        pnpm lint
        ;;
    typecheck)
        ensure_node_modules
        pnpm check-types
        ;;
    test)
        ensure_node_modules
        pnpm test
        ;;
    build)
        ensure_node_modules
        pnpm build
        ;;
    frontend-check)
        ensure_node_modules
        pnpm lint
        pnpm check-types
        pnpm test
        ;;
    rust-check)
        cd src-tauri
        cargo clippy --all-targets --locked -- -D warnings
        cargo nextest run --locked
        ;;
    bundle)
        ensure_node_modules
        tauri_args=()
        # Updater artifacts need a signing key; a plain local build skips them.
        if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
            tauri_args=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
        fi
        pnpm tauri build "${tauri_args[@]}" "$@"
        copy_bundles
        ;;
    pnpm | npx | node)
        ensure_node_modules
        exec "$task" "$@"
        ;;
    *)
        exec "$task" "$@"
        ;;
esac
