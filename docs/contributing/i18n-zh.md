# 简体中文界面本地化规范（zh-CN）

本文件是 Terax 中文 UI 文案的唯一约定。它补充 [TERAX.md](../../TERAX.md) 的「UI localization」小节，
说明哪些文案要翻译、术语怎么统一、代码怎么写、提交前怎么验证。

## 1. 目标

- **完整**：`zh-CN` 下主窗口与设置窗口的所有用户可见文案都是中文，不出现中英文混排的句子。
- **稳定**：英文原文就是翻译 key；改了英文就必须同步改字典，否则检查会报 stale。
- **一致**：同一个概念全文只用一个中文说法。
- **可回归**：`pnpm i18n:verify` 与 `pnpm test` 会在出现未翻译文案时失败。

## 2. 翻译什么

以下位置全部算用户可见文案：

- React 组件的文本节点、标题、按钮、标签、占位符、`title`、`aria-label`、`alt`。
- 空状态、加载状态、错误状态、确认对话框、toast、右键菜单、命令面板。
- 设置页所有说明、选项标签、校验提示（示例代码除外）。
- AI 面板、终端命令块覆盖层、状态栏、标签栏、更新弹窗。
- 窗口标题、`document.title`、相对时间（`3m ago`）、按语言变化的日期与数字格式。

## 3. 不翻译什么

- 品牌与产品名：Terax、GitHub、Git、WSL、Windows、macOS、Linux、Arch、Debian、Ubuntu、Fedora、RHEL。
- AI 服务商与模型名：OpenAI、Anthropic、Google、Groq、Cerebras、xAI、OpenRouter、Ollama、LM Studio、模型 ID；
  `OpenAI Compatible` 译「OpenAI 兼容」。
- 技术名词：WebGPU、WebGL、Ghostty、Shell、PATH、URL、API、JSON、Markdown、Vim、Nerd Font、Rust、Python、
  TypeScript、npm、pnpm、Apache 2.0、M/KB/MB/GB/px。
- 键盘按键：Enter、Esc、Tab、Shift、Option、Command、Ctrl、Page Up、Home、End 等。
- 文件路径、URL、示例文件名（`example.ts`）、代码片段、CLI 命令、正则、终端输出、AI 生成内容、用户数据。
- 语言选择器中的语言名（`English`、`简体中文`）。
- Rust、git、模型服务商返回的原始错误文本：外部内容保留原文；前端自己拼的错误文案要翻译。
- 开发、基准、日志文案（`src/bench`、`console.*`、终端诊断）。

技术名词嵌在中文句子中时保留拉丁写法，例如「此 Shell 不支持命令块与目录跟踪」。

## 4. 术语表

| English | 中文 | 备注 |
| --- | --- | --- |
| Agent / Agents | 代理 | `AI agent` → 「AI 代理」 |
| Space | 空间 | |
| Tab | 标签页 | |
| Pane | 窗格 | |
| Workspace | 工作区 | |
| Explorer | 文件浏览器 | |
| Source Control | 源代码管理 | |
| Terminal | 终端 | |
| Block / Blocks | 命令块 / 命令块终端 | 光标形状的 `Block` 是「方块」，用 `Block\|cursor` 区分 |
| Provider | 服务商 | |
| Model | 模型 | |
| Session | 会话 | |
| Prompt | 提示词 | |
| Token | 令牌 | |
| Commit | 提交 | |
| Stage / Unstage | 暂存 / 取消暂存 | |
| Discard | 丢弃 | |
| Stash | 贮藏 | |
| Worktree | 工作树 | |
| Upstream | 上游 | |
| Branch | 分支 | |
| Diff / Hunk | 差异 / 差异块 | |
| Merge / Rebase | 合并 / 变基 | |
| Push / Pull / Fetch | 推送 / 拉取 / 获取 | |
| Snippet | 片段 | |
| Persona | 角色 | |
| Handle | 句柄 | |
| Theme | 主题 | |
| Shortcut | 快捷键 | |
| Settings | 设置 | |
| Preview | 预览 | |
| Built-in / Custom | 内置 / 自定义 | |
| Cloud / Local | 云端 / 本地 | |
| Connected | 已连接 | |
| Finder / File Manager | 访达（macOS）/ 文件管理器 | Linux 不能显示 Finder |

## 5. 代码约定

### 5.1 key 就是英文原文

- `t()` 的 key 是当前英文文案本身，逐字保留，包裹时不要顺手改写。
- 英文需要改写时，同时改字典条目并重跑 `pnpm i18n:check`；旧 key 会变成 stale。

### 5.2 React 用 `useT`，非 React 在调用时用 `t`

```tsx
const t = useT();
return <span>{t("Save")}</span>;
```

```ts
import { t } from "@/i18n";

toast.error(t("Could not save"));
```

- 禁止在模块顶层执行 `t()`：语言切换后不会重新计算。
- `useMemo` / `useCallback` 里生成译文时，依赖里要有 `useLocale()` 的 locale；
  否则切换语言后缓存不会失效。

### 5.3 引号与格式

- 新增 `t()` 与字典条目默认双引号，内层引号用 `\"`；当文案本身含双引号时 Biome 会规范成单引号（例如 `t('Discard changes in "{label}"?')`），这是允许的，检查器两种引号都识别。
- 中文值使用全角标点：，。：；！？（）「」；**禁止使用 U+2014 长破折号**（检查器会失败）。
- 数字/英文与汉字之间保留一个半角空格，与现有条目一致：「12 个窗格」「3 KB/行」。
- 源文中的 HTML 实体按渲染后的字符作 key：`Install &amp; restart` → `t("Install & restart")`。
- 字典会作为懒加载 chunk 计入 `total client JS` 预算；`pnpm size` 另有一条 `zh-CN locale pack` 上限（30 KB gzip），新增大量文案时注意这条预算。

### 5.4 占位符与单复数

```ts
t("Close {name}?", { name });
t("{count} files", { count });
```

- 占位符统一 `{name}`、`{count}` 形式；中文值必须保留同名占位符。
- 单复数用显式分支，不要写 `t(cond ? "a" : "b")`（检查器只识别直接的字面量）：

```ts
const label = count === 1 ? t("1 file") : t("{count} files", { count });
```

### 5.5 语境键

同一个英文在不同语境下中文不同时，用 `|` 加语境：

```ts
t("Close|tab");      // 关闭
t("Block|cursor");   // 方块
```

`t()` 查找时先精确匹配，再去掉 `|` 后匹配；字典可以只为需要的语境建条目。

### 5.6 紧跟 React 节点的标签

当标签后面是图标或 React 节点时，把分隔符放进 key，让中文标点可控：

```tsx
<span>{t("Model:")}</span>
```

### 5.7 日期、时间与数字

- 日期、时间、相对时间、紧凑数字统一用 `src/i18n/format.ts`：
  `formatDateTime`、`formatCompactDateTime`、`formatRelativeTime`、`formatNumber`。
- 这些函数按当前 UI 语言而不是操作系统语言格式化；英文 UI 在中文系统上也保持英文格式。
- 相对时间词（`just now`、`{count}m ago`）同样走字典。

### 5.8 窗口元信息

- `setLocale` / `bootI18n` 负责把 `<html lang>` 设为当前 locale。
- 设置窗口在挂载后设置 `document.title` 与 Tauri 窗口标题为「设置 — Terax」；
  语言切换后要更新。

### 5.9 后端传来的标签

后端返回的标签（例如 git 的 `Added` / `Modified` / `Untracked`）在前端按值映射到显式 `t()`
（如 `t("Added|git")`），不要直接 `t(runtimeString)`；未知值回退原文。

## 6. 提交前验证

```bash
pnpm i18n:verify        # 字典缺失/过期/长破折号 + 源码硬编码英文
pnpm test               # 覆盖测试、占位符、重复 key、中文值拉丁词
pnpm lint               # Biome
pnpm check-types        # tsc
```

- `i18n:verify` 必须为 0 退出码。
- `pnpm test` 中 `src/i18n` 的测试必须通过。
- 新增文案时先在代码里写 `t("English source")`，再在 `src/i18n/locales/zh-CN.ts`
  按模块分组补条目，最后跑上面的命令。

## 7. 新增一条文案的流程

1. 确认它属于第 2 节的用户可见文案。
2. 用 `useT()` / `t()` 包裹，key 用当前英文原文；必要时加语境。
3. 需要变量时用占位符，需要单复数时显式分支。
4. 在 `src/i18n/locales/zh-CN.ts` 对应模块分组下加中文条目，保留占位符。
5. 跑 `pnpm i18n:verify` 与 `pnpm test`。
6. 如果确实不该翻译，把精确字符串加入 `scripts/i18n-allowlist.mjs` 并写一行原因。

## 8. review checklist

- [ ] 英文 UI 文案没有被顺手改写。
- [ ] 没有中英文混排的整句；技术名词符合第 3 节。
- [ ] 术语与第 4 节一致。
- [ ] 占位符、单复数、冒号/标点正确。
- [ ] 组件内用了 `useT`，非组件在调用时求值。
- [ ] 语言切换后该文案会更新（memo 依赖、窗口标题、日期格式）。
- [ ] `pnpm i18n:verify`、`pnpm test`、`pnpm lint`、`pnpm check-types` 通过。
