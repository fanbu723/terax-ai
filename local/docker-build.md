# 本机构建复现命令

命令针对本机环境：Docker Hub 与 github.com 不可达。所有命令在**仓库根目录**执行，
compose 文件位于 `local/docker-compose.yml`，构建上下文仍是仓库根。

```sh
# 首次：复用本地 ubuntu:22.04 基础镜像（Docker Hub 不通时必需）
docker buildx use default
docker compose -f local/docker-compose.yml build

# 全量三件套（deb + rpm + appimage）
docker compose -f local/docker-compose.yml run --rm \
  -e TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE='https://ghfast.top/https://github.com/<owner>/<repo>/releases/download/<version>/<asset>' \
  dev bundle

# 只打 deb/rpm（不走 GitHub，无需镜像变量）
docker compose -f local/docker-compose.yml run --rm dev bundle --bundles deb,rpm
```

- 产物出现在仓库根的 `artifacts/`（已被 `.gitignore` 忽略）。
- `TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE` 由 tauri-bundler 识别，用于改写
  AppImage 工具链的三次 GitHub Release 下载；占位符为 `<owner>` `<repo>` `<version>` `<asset>`。
- 镜像里的 `cargo-nextest` 因 GitHub 阻断未能安装，`rust-check` 任务不可用。
- 想省掉 `-f`：`export COMPOSE_FILE=local/docker-compose.yml`，之后直接 `docker compose …`。
