# local/ —— fork 专属内容

这个目录只放**本 fork 自己的工作方式**，与上游项目内容物理隔离：上游的 `docs/`、`src/`、
`src-tauri/` 不包含这里的任何文件。目录**入库**（`own` 分支可见），但结构上与项目文档分开。

设计原则：产品相关的东西留在项目里，工作方式相关的东西放这里。

## 文件清单

| 路径 | 内容 |
| --- | --- |
| `COMMIT_CONVENTION.md` | 本人提交规范（中文 subject、可选 `vX.Y.Z` 前缀、发版走 `v*` tag） |
| `docker-compose.yml` | 容器构建环境（构建上下文为仓库根，卷缓存与旧配置共用 `terax-build_*`） |
| `Dockerfile` | 工具链镜像 |
| `Dockerfile.dockerignore` | BuildKit 的 Dockerfile 专属忽略文件（模式相对仓库根） |
| `docker/entrypoint.sh` | 容器入口的任务分发器 |
| `docker-build.md` | 本机构建复现命令（镜像加速、网络受限说明） |
| `docs/dev-workflow/README.md` | 容器化开发流程手册 |
| `docs/contributing/containerized-build.md` | 容器环境设计说明 |
| `docs/contributing/commits.zh-CN.md` | 提交规范的历史长版（已由 `COMMIT_CONVENTION.md` 取代，保留参考） |

## 留在项目里的东西（刻意没有搬进来）

| 文件 | 原因 |
| --- | --- |
| `docs/contributing/i18n-zh.md` | i18n 是已上线功能的产品策略，`TERAX.md` 引用它 |
| `TERAX.md` | 上游架构文档，其中字体与 i18n 两节描述已发布代码 |
| `.github/workflows/desktop-bundles.yml` | CI 资产，随项目构建 |
| `src/**`、`scripts/i18n-*` | 产品代码与校验脚本 |

## 常用命令（在仓库根目录执行）

```sh
export COMPOSE_FILE=local/docker-compose.yml   # 之后可省略 -f

docker compose build                  # 构建工具链镜像（改过 Dockerfile 才需要重建）
docker compose run --rm dev           # 交互 shell
docker compose run --rm dev frontend-check
docker compose run --rm dev rust-check
docker compose run --rm dev bundle    # 完整 Linux 打包，产物在 artifacts/
```

等价写法：`docker compose -f local/docker-compose.yml run --rm dev bundle`。

细节见 [docker-build.md](docker-build.md) 与 [docs/dev-workflow/README.md](docs/dev-workflow/README.md)。
