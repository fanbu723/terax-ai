# Terax build environment: frontend, Rust workspace and Linux bundles compile
# here, so the host needs no Node, Rust or GTK toolchain. Ubuntu 22.04 matches
# the Linux release runner (glibc 2.35).
ARG UBUNTU_VERSION=22.04
FROM ubuntu:${UBUNTU_VERSION}

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_MAJOR=24
ARG PNPM_VERSION=11.9.0

# linuxdeploy ships as an AppImage and the container has no FUSE.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    APPIMAGE_EXTRACT_AND_RUN=1 \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

# Tauri v2 Linux prerequisites plus the deb/rpm/AppImage bundler toolchain.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential ca-certificates curl file git pkg-config patchelf rpm \
        libgtk-3-dev librsvg2-dev libssl-dev libwebkit2gtk-4.1-dev libfuse2 \
        libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
        gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
        gstreamer1.0-plugins-bad gstreamer1.0-libav \
        fish zsh python3 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "pnpm@${PNPM_VERSION}" \
    && npm cache clean --force

RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
        | sh -s -- -y --no-modify-path --profile minimal --default-toolchain stable \
    && rustup component add clippy rustfmt \
    && chmod -R a+w "$RUSTUP_HOME" "$CARGO_HOME"

RUN ARCH="$(dpkg --print-architecture)"; \
    case "$ARCH" in \
        amd64) NEXTEST=https://get.nexte.st/latest/linux ;; \
        arm64) NEXTEST=https://get.nexte.st/latest/linux-arm ;; \
        *) NEXTEST="" ;; \
    esac; \
    if [ -n "$NEXTEST" ]; then \
        curl -LsSf "$NEXTEST" | tar zxf - -C "$CARGO_HOME/bin"; \
    else \
        cargo install cargo-nextest --locked; \
    fi

WORKDIR /workspace

COPY docker/entrypoint.sh /usr/local/bin/terax-entrypoint
RUN chmod 0755 /usr/local/bin/terax-entrypoint

ENTRYPOINT ["/usr/local/bin/terax-entrypoint"]
CMD ["shell"]
