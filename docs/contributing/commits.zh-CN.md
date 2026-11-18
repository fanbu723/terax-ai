# 提交规范（Git Commit Conventions）

本文件是 [CONTRIBUTING.md](../../CONTRIBUTING.md) 中「Branches」「Commits & PRs」两节的展开版，
用于统一本仓库的提交信息、分支命名与 PR 标题。两者冲突时以 `CONTRIBUTING.md` 为准。

适用范围：本仓库的全部提交（含 fork 上的个人分支）。上游不接受从 fork 的 `main` 直接开 PR，
分支与提交规范同样适用于 fork 内的工作。

## 1. 为什么要有规范

- **可读历史**：`git log --oneline` 能直接看出改动性质，不必逐个打开 diff。
- **可检索**：`fix(pty)` 能一次筛出终端相关的全部修复。
- **自动化基础**：`feat` / `fix` / `perf` 是生成发布说明与语义化版本的依据。
- **降低 review 成本**：一个提交只做一件事，评审者不必在无关改动间跳转。

## 2. 提交信息结构

```
<type>(<scope>): <subject>
<空行>
<body>
<空行>
<footer>
```

| 部分 | 必填 | 规则 |
| --- | --- | --- |
| `type` | 是 | 见第 3 节，全小写 |
| `scope` | 建议 | 见第 4 节，全小写，可为空 |
| `subject` | 是 | 见第 5 节；建议 ≤ 50 字符，硬上限 72 |
| `body` | 视情况 | 见第 6 节；每行 ≤ 72 字符 |
| `footer` | 视情况 | 见第 7 节：破坏性变更、关联 issue、共同作者 |

只有 `subject` 一行时也必须保证 `type` 与冒号格式正确。

## 3. type 类型

| type | 用途 | 进发布说明 |
| --- | --- | --- |
| `feat` | 新增用户可见功能 | 是 |
| `fix` | 修复缺陷 | 是 |
| `perf` | 性能优化（行为不变） | 是 |
| `refactor` | 重构（不新增功能、不修缺陷） | 否 |
| `docs` | 文档、注释、示例 | 否 |
| `test` | 测试新增或调整 | 否 |
| `build` | 构建系统、依赖、打包配置 | 视情况 |
| `ci` | CI/CD 配置与工作流 | 否 |
| `chore` | 杂项：工具配置、脚手架、依赖清理 | 否 |
| `security` | 安全修复或加固（本仓库自定义类型） | 是 |
| `revert` | 回滚此前的提交 | 是 |

规则：

- `security` 用于路径校验、IPC 白名单、SSRF、凭据处理等安全面改动；**不要**把安全修复写成 `fix` 后不说明，安全修复需要单独可见。
- 一次提交只用一个 type。既加功能又改文档时，拆开；若确实无法拆，按**主要目的**取 type，其余在正文说明。
- 没有 `style` 类型：格式问题由 Biome 处理，不单独提交（避免污染 `git blame`）。

## 4. scope 范围

`scope` 表示受影响的模块，全小写，尽量与目录或功能名对应：

- **前端模块**：`terminal` `editor` `explorer` `ai` `agents` `settings` `tabs` `shortcuts` `ui` `git` `preview` `i18n` `sidebar` `statusbar` `command-palette`
- **原生侧**：`pty` `fs` `control` `lsp` `updater` `window`
- **平台**：`windows` `linux` `macos` `wsl`
- **工程**：`deps` `ci` `build` `docs` `docker`

规则：

- 跨模块改动可省略 scope，或取最上层模块（如 `ui`）。
- 不要自造过细的 scope（如 `fix(GeneralSection-button-3)`），也不要把 PR 号写进 scope。
- 依赖升级统一用 `deps`，不要把包名当 scope：`build(deps): bump tauri to 2.12`。

## 5. 描述（subject）

- 用**祈使句、现在时**描述这次提交做了什么：`add` / `fix` / `remove` / `keep` / `avoid`，不要写 `added` / `adds` / `fixing`。
- 首字母小写（`type` 与 `scope` 之后），**句末不加句号**。
- 不要写「update code」「fix bug」「modify files」这类无信息量的描述。
- 长度建议 ≤ 50 字符，硬上限 72；超了就把细节移到正文。
- 中文描述允许，但**同一仓库不要混用**；本仓库历史均为英文，新增提交建议保持英文。
- 冒号后必须有且仅有一个空格。
- 需要引用 PR/issue 时写在 footer，不要塞进 subject（squash 时平台会自己加 `(#1234)`）。

## 6. 正文（body）

正文回答「为什么」和「怎么做的」，而不是重复 diff：

- **Why**：原来的问题是什么，触发条件是什么。
- **How**：方案要点、取舍、被否决的替代方案。
- **影响面**：受影响的平台、需要联动修改的地方、需要注意的行为变化。

格式要求：

- 与 subject 之间空一行。
- 每行 ≤ 72 字符，便于终端阅读。
- 可用 `-` 列表、代码块；不要用 Markdown 标题（部分工具显示异常）。

## 7. 页脚（footer）

### 7.1 破坏性变更

用 `BREAKING CHANGE:` 开头（大写），后接影响与迁移方式。也可在 type 后加 `!`：

```
feat(settings)!: rename uiLanguage values

BREAKING CHANGE: `uiLanguage: "zh"` 不再被接受，请改为 `zh-CN`。
旧值会在加载时自动映射，但下次写入将使用新值。
```

`!` 与 `BREAKING CHANGE:` 同时出现是可以的：前者给人和工具快速识别，后者给出细节。

### 7.2 关联 issue

```
Closes #1155
Refs #955, #968
```

- `Closes` / `Fixes`：合并后自动关闭。
- `Refs`：仅关联，不关闭。
- 未经确认不要用 `Closes` 关联尚未验证的需求。

### 7.3 共同作者

AI 辅助或结对完成时追加：

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

每个合作者一行，放在页脚最后。

## 8. 分支命名

从 `main` 切出，使用前缀 + kebab-case：

| 前缀 | 用途 | 示例 |
| --- | --- | --- |
| `feat/` | 新功能 | `feat/i18n-zh-ui` |
| `fix/` | 缺陷修复 | `fix/explorer-focus` |
| `chore/` | 工具、配置、依赖 | `chore/docker-dev-env` |
| `docs/` | 纯文档 | `docs/commit-conventions` |
| `perf/` | 性能 | `perf/terminal-glyph-atlas` |
| `security/` | 安全修复或加固 | `security/path-guard` |

规则：

- 全小写，单词间用 `-`，不要用下划线、空格、中文或日期后缀。
- 一个分支只做一件事；需要并行时切多个分支。
- 不要在 fork 的 `main` 上开发后直接开 PR。
- 合并后删除远端分支（`git push origin --delete <branch>`）。

## 9. PR 标题与合并方式

- **PR 标题就是 squash 后的提交信息**，格式必须与提交信息一致（第 2–5 节）。
- PR 正文按 [PR 模板](../../.github/pull_request_template.md) 填写：What / Why / How / Testing / Screenshots / Notes。
- 多数 PR 走 **squash merge**：分支内的中间提交可以自由编辑，但标题必须合规。
- 多提交且每个提交都可独立编译、独立解释时，维护者可选择 merge commit（安全审计、多步重构）。此时分支内每个提交都要符合本规范。
- 合并后由平台追加 `(#PR号)`，无需手写。

## 10. 提交粒度

一个提交应当是**可独立理解、可独立回滚**的最小单元：

- 代码改动与其测试放在同一个提交，不要分成「加代码」和「补测试」两个。
- 依赖升级与因升级产生的适配改动放在同一个提交。
- 纯格式化、重命名不要与逻辑改动混在一起。
- 不要提交半成品（编译不过、测试红的中间态），除非明确标注为 WIP 且不推送。

## 11. 示例库

### 好例子

```
feat(terminal): add split panes
```
```
fix(explorer): prevent input from disappearing on create
```
```
fix(pty): keep pending Ctrl+V presses through key repeat

Key repeat events arrive after the paste keymap ran, so a held Ctrl+V
re-triggered the browser paste path and cleared the pending sequence.
Track the pending press until the next non-repeat keydown.
```
```
security(ai): tighten path guard

Re-canonicalize after the deny-prefix check so a symlink cannot escape an
allowed root between the two lookups.
```
```
feat(settings)!: rename uiLanguage values

BREAKING CHANGE: `zh` is no longer accepted; use `zh-CN`.
```
```
build(deps): bump tauri to 2.12
```
```
revert: feat(terminal): add split panes

This reverts commit 1a2b3c4. The split layout broke tab restore on Windows.
```

### 坏例子与原因

| 反例 | 问题 |
| --- | --- |
| `update` | 没有 type，也没有说明改了什么 |
| `fix bug` | type 与描述重复，无信息量 |
| `Fix(Explorer): Close Button.` | type/scope 大写、描述首字母大写、结尾句号、使用过去式语境 |
| `feat: 增加分屏` | 与仓库既有语言不一致（中文项目可，但需全仓库统一） |
| `feat(terminal): add split panes and fix explorer bug and bump deps` | 一个提交做了三件事 |
| `feat: fixed the thing mentioned in the issue` | 过去式、指向不明确，未用 footer 关联 |
| `chore: format` | 纯格式应交给 Biome，且未说明范围 |
| `feat(i18n): add zh-CN (#968)` | 手写 PR 号，squash 时会产生重复 |
| `WIP` | 不可合并的中间态，不应推送 |

## 12. 常见反例（进阶）

- **type 选错**：给用户可见的新行为用了 `chore`，导致发布说明漏掉；或行为不变的内部重构写成 `feat`，虚增版本号。
- **scope 泛滥**：同一提交涉及 3 个模块却硬塞一个 scope，误导检索。
- **正文重复 diff**：把改了哪些行抄一遍，却不解释动机。
- **隐藏破坏性变更**：改了 IPC 命令签名、配置键名或持久化格式却没写 `BREAKING CHANGE:`。
- **测试与实现分离**：代码提交通过了但测试在下一个提交，导致 bisect 时中间态不可用。
- **夹带无关改动**：修 bug 时顺手重排 import、重排 props、格式化未触碰文件，使 diff 无法评审。
- **在提交信息里写「根据 AI 建议」但不说明方案**：AI 只是手段，结论与取舍必须自己讲清。

## 13. 提交前自查清单

- [ ] 当前分支不是 `main`，且分支名符合第 8 节
- [ ] `type` 正确，`scope` 指代准确
- [ ] `subject` 是祈使句、首字母小写、无句末标点、≤ 72 字符
- [ ] 正文说明了「为什么」，而不只是「改了什么」
- [ ] 有破坏性变更时写了 `BREAKING CHANGE:`
- [ ] 关联 issue 用的是 `Closes` / `Refs`
- [ ] 没有夹带无关的格式化或重排
- [ ] 本地检查通过：`pnpm lint`、`pnpm check-types`、`pnpm test`；动过 `src-tauri/` 时再加 `cargo clippy --all-targets --locked -- -D warnings` 与 `cargo nextest run --locked`
- [ ] AI 辅助完成时追加了 `Co-authored-by` 页脚

## 14. 与工具链的关系

- **CI**（[ci.yml](../../.github/workflows/ci.yml)）不校验提交信息格式，因此格式靠自觉；评审与 squash 时由维护者把关。
- **CodeRabbit**（[.coderabbit.yaml](../../.coderabbit.yaml)）会做第一轮自动评审，它不替代人工评审。
- **发布说明**：`feat` / `fix` / `perf` / `security` 是发布说明的来源，写错 type 会直接影响发布内容。
- 本仓库当前**没有** commit-msg hook，也没有 commitlint；如后续引入，本文件即为规则来源。

## 15. 相关文档

- [CONTRIBUTING.md](../../CONTRIBUTING.md)：分支、PR 与质量门槛的权威说明
- [PR 模板](../../.github/pull_request_template.md)：PR 正文结构
- [测试指南](testing.md)：什么改动必须带测试
- [TERAX.md](../../TERAX.md)：架构与代码约定的唯一事实来源
