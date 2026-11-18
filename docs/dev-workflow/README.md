# 容器化开发流程

在 macOS 上把 Terax 的全部工具链放进 Docker，宿主只保留 Docker、git 和编辑器。
本文是这个工作流的操作手册；架构与代码约定仍以 [TERAX.md](../../TERAX.md) 为准，
容器环境本身的设计见 [containerized-build.md](../contributing/containerized-build.md)。

## 1. 目标与能力边界

宿主不安装 Node、pnpm、Rust、GTK/WebKit、Tauri 打包器，所有编译都在容器内完成。

| 能力 | 是否可用 |
| --- | --- |
| 编辑代码、git 操作、开 PR | 是（宿主） |
| `pnpm lint` / `check-types` / `test` | 是（容器） |
| `cargo clippy` / `cargo nextest` | 是（容器） |
| 打 `.deb` / `.rpm` / `.AppImage` | 是（容器，产物在 `./artifacts`） |
| 运行 `pnpm tauri dev`（看到应用窗口） | 否 |
| 产出 macOS `.app` / `.dmg` | 否（需要 macOS SDK）；改由 [macOS app workflow](../../.github/workflows/macos-app.yml) 在 CI 构建 |
| 产出 Windows 安装包 | 否（需要 Windows SDK） |
| 预览自己改动的 UI | 否（只能看已发布的版本） |

容器内没有显示服务器，也没有 Wayland/X11 socket 与 GPU 直通，因此 `pnpm tauri dev`
起不来。macOS 宿主上的 Docker 跑的是 Linux 虚拟机，看不到窗口，这与配置无关。

macOS 的 `.app` / `.dmg` 需要 macOS SDK 与平台链接器，Linux 容器物理上产不出来。
因此这类产物走 [`.github/workflows/macos-app.yml`](../../.github/workflows/macos-app.yml)：
在 `workflow_dispatch` 里手动触发，跑完在 run 页面下载 `terax-macos-arm64` artifact
（内含 `Terax-<arch>.app.zip` 与 `.dmg`）。该 workflow 不需要任何签名 secrets，
产物未签名，只适合自己本机使用。**不要在 workstation 上装工具链来绕开这一点**，
那正是本工作流要避免的事。

## 2. 宿主需要什么

| 工具 | 必需 | 用途 |
| --- | --- | --- |
| Docker Desktop（或 OrbStack） | 必需 | 容器运行时，需 Compose v2 |
| git | 必需 | 分支、提交、推送 |
| VS Code | 必需 | 编辑；推荐扩展见 [extensions.json](../../.vscode/extensions.json) |
| Release 版 `Terax.app` | 按需 | 只用于运行已发布版本，无需工具链 |
| Node / pnpm | 不需要 | 全部在容器里 |
| Rust / cargo | 仅编辑器提示 | rust-analyzer 需要 sysroot 才能分析代码 |

注意宿主工具链与容器存在版本差异（例如宿主 Node 26、容器 Node 24），
不要在宿主直接跑 pnpm 命令，否则 lint/测试结果可能和 CI 不一致。

编辑器两处降级，属预期行为：

- `.vscode/settings.json` 指向 `node_modules/typescript/lib`，宿主没有该目录时
  VS Code 回退到内置 TypeScript，诊断结果可能与 `pnpm check-types` 不同。
- 不安装 Rust 时，rust-analyzer 只能提供语法着色。

## 3. 首次准备

```bash
git switch -c feat/your-change   # 分支前缀见 CONTRIBUTING.md
docker compose build             # 首次构建镜像，约 4 GB，数分钟
docker compose run --rm dev      # 进交互 shell，首次会自动 pnpm install
```

`docker compose run` 在镜像缺失时会自动构建，但**镜像已存在时不会重建**。
改过 `Dockerfile` 之后必须显式执行 `docker compose build`。

## 4. 日常循环

```
新建分支 → 改代码 → 容器内检查 → 提交 → 推送 → 开 PR → CI → 合并
```

### 4.1 改代码

直接用宿主编辑器修改工作区文件。源码通过 bind mount 进入容器，
编译产物写入命名卷，宿主工作区不会出现 `target/`、`node_modules` 之类的构建缓存。

### 4.2 容器内检查（提交前必做）

```bash
docker compose run --rm dev frontend-check   # pnpm lint + check-types + test
docker compose run --rm dev rust-check       # cargo clippy -D warnings + nextest
```

只改了一小块时可以跑单项：

```bash
docker compose run --rm dev pnpm vitest run src/modules/terminal
docker compose run --rm dev cargo test --locked -p terax-control-protocol
```

### 4.3 提交

提交信息遵循 Conventional Commits（PR 标题会成为 squash 提交）：

```bash
git add -A
git commit -m "feat(terminal): add split panes"
git push -u origin feat/your-change
```

常用 type：`feat` `fix` `chore` `docs` `perf` `refactor` `test` `build` `ci` `security`。
分支前缀：`feat/` `fix/` `chore/` `docs/` `perf/` `security/`（kebab-case）。

### 4.4 PR 与 CI

PR 一开，[ci.yml](../../.github/workflows/ci.yml) 自动运行：

| Job | 内容 | 是否阻断 |
| --- | --- | --- |
| `frontend` | lint、类型检查、单测、构建、体积预算 | 阻断 |
| 同上 | `pnpm audit`、React Compiler 体检、`knip` | 仅提示 |
| `terminal-platforms` | Windows/macOS 上的终端模型与渲染测试 | 阻断 |
| `rust` | check、clippy、nextest、fish/bash/zsh 集成脚本 | 阻断 |
| `rust-platforms` | Windows/macOS/Linux arm64 的 check + nextest | 阻断 |
| `coverage` | `cargo llvm-cov`（依赖 `rust`） | 阻断 |

同时 CodeRabbit 会做第一轮自动评审，它只是初筛，人工评审才是合并门禁。

### 4.5 合并与发版

合并进 `main` 之后，只有推送 `v*` 标签才会触发
[release.yml](../../.github/workflows/release.yml) 产出安装包；
发布链接随后触发 [update-nix-sources.yml](../../.github/workflows/update-nix-sources.yml)
更新 Nix 清单。

## 5. 容器命令速查

| 命令 | 作用 |
| --- | --- |
| `docker compose run --rm dev` | 交互 shell（自动确认依赖） |
| `docker compose run --rm dev frontend-check` | lint + 类型 + 单测 |
| `docker compose run --rm dev rust-check` | clippy + nextest |
| `docker compose run --rm dev build` | `tsc` + Vite 构建（写出 `dist/`） |
| `docker compose run --rm dev bundle` | 完整 Linux 打包，产物拷到 `./artifacts` |
| `docker compose run --rm dev install` | 重新执行 `pnpm install --frozen-lockfile` |
| `docker compose run --rm dev <任意命令>` | 直接执行，例如 `cargo fmt --check` |

打包签名：默认关闭 updater 签名，需要时显式传入密钥：

```bash
TAURI_SIGNING_PRIVATE_KEY=... TAURI_SIGNING_PRIVATE_KEY_PASSWORD=... \
  docker compose run --rm -e TAURI_SIGNING_PRIVATE_KEY \
  -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD dev bundle
```

产出 x86_64 包（Apple Silicon 上需模拟，速度明显变慢）：

```bash
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose run --rm dev bundle
```

## 6. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 改了 Dockerfile 但行为没变 | 镜像不会自动重建，执行 `docker compose build` |
| `pnpm` 找不到依赖 | 走的是 `bash`/`sh` 直通分支，未触发自动安装；先跑一次 `docker compose run --rm dev` 或 `install` |
| `install --force` 没有强制重装 | entrypoint 的 `install` 分支不转发多余参数，需要重置时先 `docker volume rm terax-build_node_modules` |
| 切换 arm64/amd64 后编译全量重来 | 两种架构共用 `cargo_target` 卷，没有按 target 分目录 |
| `pnpm test:terminal-scaling` 失败 | 镜像内没有 Playwright chromium 及系统依赖 |
| coverage / `cargo machete` 无法本地复现 | 镜像未安装 `cargo-llvm-cov`、`cargo-machete` |
| 磁盘占用过大 | 镜像 4 G + `cargo_target` 约 9 G + `node_modules` 0.7 G + store 0.7 G，合计约 14.5 G |
| 想清空所有缓存 | `docker compose down --volumes`，或 `docker volume rm terax-build_cargo_target` |

## 7. Fork 注意事项

在个人 fork 上：

- 需在仓库 Actions 页面手动启用 workflow。
- `release.yml` 依赖 `TAURI_SIGNING_PRIVATE_KEY`、`APPLE_*`、`SIGNPATH_API_TOKEN`
  等 secrets，缺任何一个都跑不通，日常开发也用不到。
- `signpath-test.yml` 与 `update-nix-sources.yml` 中硬编码了上游仓库
  `crynta/terax-ai`，在 fork 上不会按预期工作。

## 8. 相关文档

- [TERAX.md](../../TERAX.md)：架构与代码约定的唯一事实来源
- [CONTRIBUTING.md](../../CONTRIBUTING.md)：质量门槛、分支与提交规范
- [testing.md](../contributing/testing.md)：测试范围与写法要求
- [containerized-build.md](../contributing/containerized-build.md)：容器环境设计细节
