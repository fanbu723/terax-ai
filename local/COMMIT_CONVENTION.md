# 个人提交规范（Commit Convention）

本文件只约束**本人的提交习惯**，不替代项目规范，也不随 PR 提交。
项目官方规范见 [docs/contributing/commits.zh-CN.md](docs/contributing/commits.zh-CN.md)
与 [CONTRIBUTING.md](../CONTRIBUTING.md)；两者冲突时，对外提交以项目规范为准，
只在自己的仓库/分支上按本文件执行。

> 本文件位于 `local/`，与项目文档物理隔离（该目录单独成树，不散落在 `docs/`）。
> 下文所有路径均相对**仓库根目录**。

> **风格说明**：项目历史（v0.9.0 之前 878 条）使用英文 subject
> （例：`fix(terminal): keep pending Ctrl+V presses through key repeat`）。
> 本文件规定**本人的提交**一律用中文 subject，`type` 与 `scope` 仍为英文小写。
> 这与项目历史并存属于预期现象。

| 相关文件 | 作用 |
| --- | --- |
| `local/COMMIT_CONVENTION.md` | 本文件（个人规则，唯一约束对象是本人） |
| `local/docker-build.md` | 本机构建复现命令（Docker Hub / GitHub 受限环境） |
| `docs/contributing/commits.zh-CN.md` | 项目官方提交规范（上游文件） |
| `CONTRIBUTING.md` | 项目分支、PR 与质量门槛（权威） |
| `docs/contributing/testing.md` | 什么改动必须带测试 |
| `docs/contributing/containerized-build.md` | 容器内 lint/类型/测试/打包 |
| `.github/workflows/release.yml` | 发版链路（`v*` tag 触发） |
| `.gitignore` | 入库边界（见 §9） |

---

## 1. 格式

```text
<type>(<scope>): [vX.Y.Z ]<中文主题>

- body：为什么改 / 改了什么 / 影响与验证

footer（可选）
```

| 部分 | 必填 | 规则 |
| --- | --- | --- |
| `type` | ✅ | 变更类别，见 §2，英文小写 |
| `scope` | 建议 | 影响范围，见 §3，英文小写；跨模块可省略 |
| `vX.Y.Z ` | ⬜ | **只在推进应用版本的提交上写**，见 §6 |
| `subject` | ✅ | 中文一行，见 §4 |
| `body` | 建议 | `- ` 列表，见 §5 |
| `footer` | ⬜ | 破坏性变更、issue 关联、共同作者，见 §7 |

- 首行建议 ≤ 50 字符、**硬上限 72**（中文按字符计）；超了把细节移到正文。
- 冒号后**有且仅有一个空格**；`type` 与 `scope` 之间不能有空格。
- 首行与正文之间空一行。

---

## 2. type（必填，英文小写）

| type | 用途 | 本仓库历史用量 |
| --- | --- | --- |
| `feat` | 新增用户可见能力（含恢复机制、重要性能优化） | 217 |
| `fix` | 缺陷与现场问题修复、口径修正 | 265 |
| `perf` | 纯性能优化（行为不变） | 46 |
| `refactor` | 不改外部行为的结构调整（拆分、下沉、去兼容层） | 14 |
| `docs` | 只动文档、注释、示例 | 39 |
| `test` | 只动测试 | 54 |
| `build` | 构建系统、依赖、打包、产物、运行脚本 | 72 |
| `ci` | CI/CD 工作流与发布流水线 | 17 |
| `chore` | 仓库级卫生、工具配置、脚手架（兜底，需在正文说明） | 48 |
| `security` | 安全加固与越权修复（路径校验、IPC 白名单、SSRF、凭据处理） | 8 |
| `revert` | 回滚此前提交（subject 写被回滚提交的首行） | 3 |

规则：

- **一次提交只用一个 type**；既加功能又改文档时拆开，确实拆不开就按**主要目的**取 type，其余在正文说明。
- `security` 必须单独可见，不要写成 `fix` 了事：安全修复需要能被审计检索出来。
- 依赖升级统一用 `build(deps)` / `build(deps-dev)`，**不要**用包名当 scope。
- **不设** `style` / `cleanup` / `config` 三个类型：
  - 纯格式由 Biome 负责（`pnpm format` / `pnpm lint:fix`），不单独提交，避免污染 `git blame`；
  - 仓库清理归 `chore`，配置项调整归 `build` 或 `chore`，新增配置能力归 `feat`。

---

## 3. scope（建议写，英文小写）

scope 取「目录 / 功能名」的短名，与代码位置对应。下表右列是当前历史里的实际用量，新增 scope 前先确认确实无可复用的短名。

| 分类 | scope（括号内为该 scope 的历史提交数） |
| --- | --- |
| 前端 | `terminal`(131) `ai`(61) `editor`(44) `tabs`(30) `explorer`(30) `agents`(18) `ui`(17) `shortcuts`(17) `source-control`(13) `git`(13) `lsp`(13) `settings`(12) `theme`(9) `blocks`(8) `sidebar`(5) `spaces`(5) `preview`(4) `i18n` `fonts` |
| 原生侧 | `pty`(30) `fs`(12) `cli`(5) `window`(5) `control` `updater` |
| 平台 | `windows`(22) `macos`(7) `linux`(6) `wsl`(4) |
| 工程 | `deps`(61) `deps-dev`(14) `release`(14) `build`(5) `ci` `docker` `docs` `readme` `contributing` `dev-workflow` |

规则：

- 全小写，单词间用 `-`；不要下划线、空格、中文。
- 不要自造过细的 scope（如 `fix(EditorSection-button-3)`），也不要把 PR 号写进 scope。
- 一次改动横跨 3 个以上模块时省略 scope，比硬塞一个误导性的更准确。

---

## 4. subject（必填，中文）

- 动宾结构，写「**改了什么 + 影响范围**」：`修复…`、`新增…`、`下沉…`、`删除…`、`归位…`、`收紧…`。
- **单行写完**；多要点用 ` + ` 连接，不要把要点塞进正文再让首行空泛。
- **不以句号、逗号、省略号结尾**。
- 不写无宾语的空话：`优化`、`调整`、`改进`、`多处修改` 一律禁止。
- 不在 subject 里重复 type 的语义（`fix:` 之后不要再写「修复 bug：…」）。
- 不在 subject 里手写 `(#123)`：squash 合并时平台会自动追加。

---

## 5. body（建议写）

按「**为什么改**（现象与根因）→ **改了什么**（文件级要点）→ **影响与验证**（命令、测试数量、风险）」组织，用 `- ` 列表。

- 每行 ≤ 72 字符（中文按字符计），便于终端阅读。
- 不贴大段 diff，不留「待补充」「见下」这类占位符。
- **不要在正文里用反引号**：`git commit -m "…"` 的双引号内反引号会触发命令替换，
  实测会报 `bash: src/modules/：是一个目录` 并静默吞掉该词。引用代码标识就写裸词：
  `src/modules/terminal/ghostty/` 写成不加反引号的 src/modules/terminal/ghostty/。
- 可用 `-` 列表与缩进代码块（四空格），不要用 Markdown 标题。

---

## 6. 版本号与发版

**版本号以应用版本为准，不是独立于代码的流水号。** 三个文件必须同步：

| 文件 | 字段 |
| --- | --- |
| `package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version`（打包与自动更新读取此值） |
| `src-tauri/Cargo.toml` | `[workspace.package].version` 与 `[package].version` |

规则：

- `vX.Y.Z ` 前缀**只写在「把这些版本号改成 X.Y.Z」的那笔提交上**；同一版本的后续提交、
  与版本无关的修复都不带前缀。
- 版本语义：主版本=不兼容变更；次版本=新功能/恢复机制/重要性能优化；修订版本=兼容修复与文档更新。
- 取号前查重（tag 与各分支已用号）：

```bash
git tag -l 'v*' --sort=-v:refname | head -5
for r in $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes); do
  printf '%s %s\n' "$r" "$(git show "$r:src-tauri/tauri.conf.json" 2>/dev/null | grep -m1 '"version"' | tr -d ' ,"')"
done | sort -k2 -V | tail -5
```

- **发版由 tag 驱动**：`.github/workflows/release.yml` 监听 `push` 的 `v*` tag，
  用 tauri-action 构建 macOS（arm64/x86_64）、Linux（x86_64/arm64）、Windows 产物，
  创建名为 `Terax <tag>` 的 draft release：

```bash
git tag v0.9.1 && git push origin v0.9.1
```

- **fork / 实验线的 tag 不要以 `v` 开头**（例：`app-v0.9.0-zh`），否则会误触发 release 流水线。
- 本仓库**没有** `updatenote.md`，也**不要求**「代码一笔 + 版本记录一笔」的两段式提交；
  发布说明由 release 页面维护，不从提交信息生成（见 §13）。

---

## 7. footer（可选）

### 7.1 破坏性变更

```
BREAKING CHANGE: 配置键 `uiLanguage: "zh"` 不再被接受，改为 `zh-CN`。
```

（上例的反引号仅用于文档说明；实际提交时写成裸词。）也可在 type 后加 `!`：
`feat(settings)!: …`。`!` 给人和工具快速识别，`BREAKING CHANGE:` 给出迁移细节，两者可同时出现。

### 7.2 关联 issue

```text
Closes #1155
Refs #955, #968
```

`Closes` / `Fixes` 合并后自动关闭；未经确认不要用它关联尚未验证的需求。

### 7.3 共同作者

AI 辅助或结对完成时追加（放在 footer 最后，每个合作者一行）：

```text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

---

## 8. 分支与 PR

从 `main` 切出，前缀 + kebab-case，全小写：

| 前缀 | 用途 | 示例 |
| --- | --- | --- |
| `feat/` | 新功能 | `feat/i18n-zh-ui` |
| `fix/` | 缺陷修复 | `fix/explorer-focus` |
| `chore/` | 工具、配置、依赖 | `chore/docker-dev-env` |
| `docs/` | 纯文档 | `docs/commit-conventions` |
| `perf/` | 性能 | `perf/terminal-glyph-atlas` |
| `security/` | 安全修复或加固 | `security/path-guard` |

- 不要在 fork 的 `main` 上开发后直接开 PR；一个分支只做一件事。
- 合并后删除远端分支：`git push origin --delete <branch>`。
- **PR 标题就是 squash 后的提交信息**，必须符合 §2–§5；PR 正文按
  `.github/PULL_REQUEST_TEMPLATE.md` 填写（What / Why / How / Testing / Screenshots / Notes）。
- 多数 PR 走 squash merge，分支内的中间提交可以自由编辑；
  多提交且每笔都可独立编译、独立解释时，维护者可选择 merge commit（安全审计、多步重构），
  此时每笔提交都要合规。

---

## 9. 粒度与入库边界

- **一次提交只做一件事**：不要把格式化 + 功能 + 换配置混在一起；不要提交编译不过或测试红的中间态。
- 代码改动与其测试放在同一提交；依赖升级与因升级产生的适配放在同一提交。
- 逐文件 `git add <精确路径>`；**禁用** `git add .` / `git add -A`（易误纳生成物），
  **禁用** `git add -f` 触碰被忽略路径。
- 提交前 `git status --porcelain` 应为空或只包含你打算提交的文件。
- 不入库（见 `.gitignore`）：`node_modules`、`dist`、`dist-ssr`、`stats.html`、`*.tsbuildinfo`、
  `src-tauri/binaries/`（sidecar 生成物）、`artifacts/`（容器打出的包）、`__pycache__/`、
  `.vscode/*`（仅保留 `extensions.json` / `settings.json`）、`.idea`、`*.log`。
- 禁止无信息提交：

  | 反例 | 原因 |
  | --- | --- |
  | `update` / `修改` / `111` | 无 type、无信息 |
  | `fix bug` / `修复bug` | 缺 type 与具体对象 |
  | `refactor: 调整` | 缺宾语，说不清改了什么 |
  | `feat: 增加分屏并修复 explorer bug 并升级依赖` | 一笔做了三件事 |
  | `feat(i18n): 新增 zh-CN (#968)` | 手写 PR 号，squash 时重复 |
  | `chore: 格式化` | 纯格式应交 Biome |
  | `WIP` | 用 `--fixup` 或本地分支，不要推送 |

- 历史应避免「先加后删」；宁可 amend 重写，重写后用 `git diff <旧提交> HEAD` 确认内容没丢。

---

## 10. 提交前验证

只跑**覆盖改动的最小命令**；跨模块或触碰构建配置时再升级到全量。容器内执行方式见
`docs/contributing/containerized-build.md`（`docker compose run --rm dev <task>`）。

| 改动范围 | 命令 |
| --- | --- |
| 任意前端改动 | `pnpm lint`、`pnpm check-types` |
| 逻辑/组件 | `pnpm test`；单文件更快：`pnpm vitest run src/modules/<模块>/<文件>.test.ts` |
| 改过 `src/i18n/` 或新增 UI 文案 | `pnpm i18n:verify`（覆盖检查 + 硬编码审计） |
| 格式 | `pnpm format:check`（仓库统一由 Biome 管，不要手工排版无关文件） |
| 任意原生改动（`src-tauri/`） | `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings` |
| 原生逻辑 | `cd src-tauri && cargo nextest run --locked`（或 `cargo test --locked`） |
| 容器内等价 | `docker compose run --rm dev frontend-check` / `rust-check` |

- 不固定基线数字：以本次改动前后的结果对比判断是否回归；
  与本机环境相关的失败要在 PR 里注明原因，不要当成通过。
- 不要为格式化顺带改无关文件（会整仓 churn）；确需统一风格单独提 `build`/`chore` 一笔。

---

## 11. 示例

**✅ 推荐（新规范，中文）**

```text
fix(terminal): 修复冷启动时 IME 锚点丢失

- 现象：窗口首次显示后立即输入中文，候选框锚在左上角 (0,0)。
- 根因：首帧 WebGL 尺寸未就绪，锚点按 0 尺寸计算。
- 影响：仅冷启动首帧；热切换标签不受影响。
```

```text
feat(settings): v0.9.1 新增语言服务器启用开关

- 每个 preset 支持 enabled / dismissed 两种状态，持久化在 preferences。
- 未改动既有默认行为：未触碰过的语言仍只显示提示。
```

```text
build(deps): 升级 tauri 到 2.12
```

```text
docs(dev-workflow): 补充容器构建的网络受限说明
```

```text
security(ai): 收紧项目记忆的目录校验

- 先归一化再比对白名单，避免符号链接在两次查找之间逃逸。
```

```text
revert: feat(terminal): 新增分屏

回滚 1a2b3c4：分屏导致 Windows 下标签恢复失败。
```

**❌ 禁止**

```text
update
修复bug
refactor: 调整
Fix(Explorer): Close Button.
feat: 增加分屏
```

**过渡期参考（旧提交，仅示范结构，subject 为英文）**

```text
fix(pty): keep pending Ctrl+V presses through key repeat
security(ai): tighten path guard
build(deps): bump tauri to 2.12
```

---

## 12. 自查清单

- [ ] 当前分支不是 `main`，分支名符合 §8
- [ ] `type` 在 §2 白名单内，且只用一个
- [ ] `scope` 用 §3 的既有短名（或合理地省略）
- [ ] subject 是中文动宾短句、无句末标点、≤ 72 字符
- [ ] 版本前缀只出现在改版本号的那笔提交上
- [ ] 正文说明了「为什么」，并且没有反引号
- [ ] 有破坏性变更时写了 `BREAKING CHANGE:`
- [ ] 没有夹带无关格式化、生成物或忽略路径
- [ ] 本地验证命令已通过（§10），必要时贴出结果
- [ ] AI 辅助完成时追加了 `Co-authored-by` 页脚

---

## 13. 工具链现状

- **无 commit-msg hook、无 commitlint、无 `.gitmessage`**：格式靠本文件的自查与 review 把关。
  如后续引入校验，本文件即为规则来源。
- **提交信息不驱动发布说明**：`release.yml` 的 `releaseBody` 是固定文本，
  版本语义由维护者手动改三个文件的版本号。`type` 的价值在于可读性、`git log` 检索与 `git bisect`。
- **CodeRabbit**（`.coderabbit.yaml`）做第一轮自动评审，不替代人工评审。
- 自查命令：检查当前分支相对 `origin/main` 的所有提交（无法定位远端时退化为最近 5 条），
  一次性报告 type 格式、首行长度与中文缺失。**输出「N 条待修」且 N 为 0 即通过。**
  过渡期内历史英文提交会被列为「缺少中文」，属预期，只需保证自己新增的提交通过：

```bash
python3 - <<'PY'
import re, subprocess

has_origin = subprocess.run(
    ["git", "rev-parse", "--verify", "-q", "origin/main"],
    stdout=subprocess.DEVNULL,
).returncode == 0
args = ["git", "log", "--pretty=%s"] + (["origin/main..HEAD"] if has_origin else ["-n", "5"])
log = subprocess.run(args, capture_output=True, text=True).stdout

head = re.compile(
    r"^(feat|fix|perf|refactor|docs|test|build|ci|chore|security|revert)"
    r"(\([a-z0-9-]+\))?!?: \S"
)
subjects = [s for s in log.splitlines() if s and not s.startswith("Merge ")]
bad = 0
for s in subjects:
    why = []
    if not head.match(s):
        why.append("type/scope 格式不合规")
    if len(s) > 72:
        why.append(f"首行 {len(s)} 字符")
    if not re.search(r"[\u4e00-\u9fa5]", s):
        why.append("subject 缺少中文")
    if why:
        bad += 1
        print(f"{s}\n  -> {'，'.join(why)}")
print(f"共检查 {len(subjects)} 条，{bad} 条待修")
PY
```

本人提交如与本文件有出入，以本文件为准；对外提交以项目官方规范为准。
