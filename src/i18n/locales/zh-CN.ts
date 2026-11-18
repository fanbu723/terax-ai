// Simplified Chinese dictionary.
//
// Keys are the English source copy (see `src/i18n/index.ts`). Any key missing
// here falls back to English, so this file may lag the UI without breaking it.
// Run `pnpm i18n:check` to list missing and stale entries.
//
// Language names in the selector stay in their own language by convention and
// are therefore not translated here.

export default {
  // Settings -> General: language
  Language: "语言",
  "Interface language": "界面语言",
  "Follow system": "跟随系统",
  "Follow system uses your OS language. An explicit choice overrides it and is remembered.":
    "跟随系统会使用操作系统语言。手动选择会覆盖它，并在下次启动时保留。",

  // Settings -> General
  "Mode, terminal, and startup.": "外观模式、终端与启动行为。",
  Appearance: "外观",
  "For theme, background and customization, see the":
    "主题、背景与个性化设置请见",
  Themes: "主题",
  "tab.": "标签页。",
  Zoom: "缩放",
  "UI zoom level": "界面缩放比例",
  Explorer: "文件浏览器",
  "Show hidden files": "显示隐藏文件",
  "Include dot-prefixed files and folders (.env, .gitignore, .config) in the file explorer and search.":
    "在文件浏览器与搜索中包含以点开头的文件和文件夹（.env、.gitignore、.config）。",
  "Git decorations": "Git 状态标记",
  "Tint changed files and dim gitignored entries in the file explorer.":
    "在文件浏览器中为已修改文件着色，并淡化被 gitignore 的条目。",
  Terminal: "终端",
  "Terminal renderer": "终端渲染器",
  "Automatic and WebGPU draw with WebGPU and fall back to WebGL where the webview has none. WebGL is a compatibility mode: it uses more CPU and holds at most 12 visible panes per window. Applies to new terminals.":
    "自动与 WebGPU 使用 WebGPU 绘制，在不支持时回退到 WebGL。WebGL 是兼容模式：CPU 占用更高，每个窗口最多显示 12 个窗格。仅对新终端生效。",
  Automatic: "自动",
  "Screen reader support": "屏幕阅读器支持",
  "Expose terminal output as accessible text. Page Up and Page Down browse history when the output region is focused.":
    "将终端输出暴露为可访问文本。输出区域获得焦点时，Page Up 与 Page Down 可浏览历史。",
  "Cursor blinking": "光标闪烁",
  "Blink the terminal cursor. Off by default for lower idle CPU, matching VS Code and the macOS terminal.":
    "让终端光标闪烁。默认关闭以降低空闲 CPU 占用，与 VS Code 和 macOS 终端一致。",
  "Cursor style": "光标样式",
  "Shape of the terminal cursor.": "终端光标的形状。",
  Bar: "竖线",
  Block: "方块",
  Underline: "下划线",
  "Font weight": "字重",
  "Thickness of terminal characters": "终端字符的粗细",
  Normal: "常规",
  Medium: "中等",
  "Semi-Bold": "半粗",
  Bold: "粗体",
  "Integrated terminal shell": "集成终端 Shell",
  "Command blocks and directory tracking are unavailable for this shell.":
    "此 Shell 不支持命令块与目录跟踪。",
  "Shell for the integrated terminal. WSL spaces use the distro login shell. Existing tabs keep their shell.":
    "集成终端使用的 Shell。WSL 空间使用发行版的登录 Shell。已打开的标签页保持原有设置。",
  "Shell for new terminal tabs. Existing tabs keep their shell.":
    "新建终端标签页使用的 Shell。已打开的标签页保持原有设置。",
  Auto: "自动",
  "Workspace environment": "工作区环境",
  "Where new spaces run, terminal and AI agent alike: Windows or a WSL distro. Existing spaces keep theirs; switch any from the status bar.":
    "新空间（终端与 AI 代理）运行的位置：Windows 或某个 WSL 发行版。已存在的空间保持原设置；可在状态栏切换。",
  Windows: "Windows",
  "Letter spacing": "字间距",
  "Extra horizontal space between characters (px). Use negative values to tighten Nerd Fonts.":
    "字符之间的额外水平间距（px）。使用负值可收紧 Nerd Font。",
  "Font size": "字号",
  "Terminal text size.": "终端文字大小。",
  Scrollback: "回滚缓冲区",
  "Lines of history kept per terminal. Higher uses more RAM (~3 KB / line).":
    "每个终端保留的历史行数。数值越大内存占用越高（约 3 KB/行）。",
  "{count} lines": "{count} 行",
  "Option as Alt": "Option 作为 Alt",
  "Send Option as Alt (Meta) so readline and editor shortcuts like Option+B and Option+F work. Off types the characters Option produces. Keys are matched by their position on a US keyboard, so layouts that type other letters on those keys are not followed.":
    "把 Option 作为 Alt（Meta）发送，使 Option+B、Option+F 之类的 readline 与编辑器快捷键可用。关闭则输入 Option 产生的字符。按键按美式键盘的物理位置匹配，因此在那些键位上输入其他字母的布局不会遵循此设置。",
  Off: "关闭",
  "Left Option": "左侧 Option",
  "Right Option": "右侧 Option",
  Both: "两侧",
  "Scroll speed": "滚动速度",
  "Lines per wheel or trackpad movement, for history and for programs that read the mouse wheel.":
    "每次滚轮或触控板移动滚动的行数，用于历史记录以及读取鼠标滚轮的程序。",
  "Confirm before killing a running process": "结束运行中的进程前确认",
  "Ask before closing a terminal tab or quitting while a command is still running. Unsaved editor changes are always confirmed.":
    "命令仍在运行时，关闭终端标签页或退出应用会先询问。编辑器中未保存的更改始终会确认。",
  Agents: "代理",
  "Coding agent notifications": "编码代理通知",
  "Alert when a coding agent needs your input or finishes. Native notification when Terax is unfocused, in-app otherwise.":
    "当编码代理需要你的输入或完成任务时提醒。Terax 不在前台时使用系统通知，否则使用应用内提示。",
  "Notification sound": "通知声音",
  "Play a sound with agent notifications and in-app alerts.":
    "播放代理通知与应用内提示的提示音。",
  Startup: "启动",
  "Launch at login": "登录时启动",
  "Open Terax automatically when you sign in.": "登录系统时自动打开 Terax。",
  "Restore window position & size": "恢复窗口位置与大小",
  "Reopen the main window where you left it. Applies on next launch.":
    "在退出时的位置重新打开主窗口。下次启动生效。",
  "Font family": "字体",
  'Terminal font (e.g. "CaskaydiaCove Nerd Font Mono"). Icons render without a Nerd Font; leave blank to use an installed one when found.':
    '终端字体（例如 "CaskaydiaCove Nerd Font Mono"）。没有 Nerd Font 时图标仍可显示；留空则自动使用已安装的字体。',
  "Auto-detect": "自动检测",
  System: "系统",
  Light: "浅色",
  Dark: "深色",
  "Switch apps...": "请切换到其他应用...",
  "Sending...": "发送中...",
  Requested: "已请求",
  Blocked: "已阻止",
  Failed: "失败",
  "Test in 2s": "2 秒后测试",
  "Switch to another app to verify native delivery":
    "切换到其他应用以验证系统通知送达",
  "The native notification was requested": "已请求系统通知",
  "Notifications are disabled by the system": "系统已禁用通知",
  "Terax could not request a native notification": "Terax 无法请求系统通知",
  "Send a native test notification after two seconds":
    "两秒后发送一条系统测试通知",

  // Settings tabs
  Editor: "编辑器",
  Shortcuts: "快捷键",
  Models: "模型",
  About: "关于",

  // Settings -> About
  "You're up to date": "已是最新版本",
  "Check failed - retry": "检查失败，重试",
  "Checking...": "正在检查...",
  "Downloading...": "正在下载...",
  "Restart to install": "重启以完成安装",
  "Install v{version}": "安装 v{version}",
  "Update to v{version}": "更新到 v{version}",
  "Check for updates": "检查更新",
  "Open-source AI-native terminal emulator": "开源的 AI 原生终端模拟器",
  Build: "构建",
  "Bundle ID": "包标识",
  License: "许可证",
  "Source code": "源代码",
  Website: "官网",
  "View on GitHub": "在 GitHub 上查看",
  "Report an issue": "反馈问题",

  // Settings -> Themes
  "Theme, background image, and customization.": "主题、背景图片与个性化设置。",
  "Mica background": "云母背景",
  "Window vibrancy": "窗口毛玻璃",
  "Blend the header, status bar and gutters into the desktop wallpaper. Windows 11 only.":
    "让标题栏、状态栏与边距融入桌面壁纸。仅 Windows 11 支持。",
  "Frost the header, status bar and gutters over what is behind the window. Panes stay solid.":
    "让标题栏、状态栏与边距呈现窗口后方的毛玻璃效果，窗格保持不透明。",
  Theme: "主题",
  Create: "新建",
  "Import .terax-theme": "导入 .terax-theme",
  "Edit {name}": "编辑 {name}",
  "Remove {name}": "移除 {name}",
  "Editor theme": "编辑器主题",
  "Syntax colors for the code editor. Auto follows the app theme.":
    "代码编辑器的语法配色。自动表示跟随应用主题。",
  "Auto (match app theme)": "自动（跟随应用主题）",
  Background: "背景",
  Remove: "移除",
  "Choose image": "选择图片",
  "Replace image": "替换图片",
  Opacity: "不透明度",
  Blur: "模糊",
  "Drop an image here or pick one. Stored locally; doesn't affect the default look until set.":
    "把图片拖到这里或选择一张。图片保存在本地；设置之前不会影响默认外观。",

  // Settings -> Editor
  "Editing behavior, saving, and language servers.":
    "编辑行为、保存与语言服务器。",
  "Code editor text size.": "代码编辑器的文字大小。",
  Editing: "编辑",
  "Vim mode": "Vim 模式",
  "Enable Vim keybindings in the code editor.": "在代码编辑器中启用 Vim 键位。",
  "Word wrap": "自动换行",
  "Wrap long lines instead of scrolling horizontally.":
    "将长行换行显示，而不是横向滚动。",
  Saving: "保存",
  "Auto save": "自动保存",
  "Automatically save files after a delay when changes are detected.":
    "检测到改动后，延迟自动保存文件。",
  "Format on save": "保存时格式化",
  Formatter: "格式化工具",
  "Language server formats the buffer before writing; external tools run on the saved file from your PATH.":
    "语言服务器在写入前格式化缓冲区；外部工具则对已保存的文件运行，命令取自 PATH。",
  "Custom command": "自定义命令",
  "Runs on the saved file; {file} is replaced with the quoted path (appended when omitted).":
    "对已保存的文件运行；{file} 会替换为带引号的路径（省略时自动追加）。",
  "Language overrides": "按语言覆盖",
  "Use a different formatter for specific languages (e.g. Ruff for Python).":
    "为特定语言使用不同的格式化工具（例如 Python 用 Ruff）。",
  "Remove override": "移除覆盖",
  "Auto save delay": "自动保存延迟",
  "Delay before unsaved changes are saved automatically.":
    "未保存改动的自动保存延迟。",
  "Wrap column": "换行列宽",
  "Soft-wrap at this column, or earlier when the editor is narrower.":
    "在此列软换行；编辑器更窄时提前换行。",

  // Settings -> Shortcuts
  "View and customize keyboard shortcuts.": "查看并自定义键盘快捷键。",
  "Search shortcuts...": "搜索快捷键...",
  "Reset to default": "恢复默认",
  "Clear shortcut": "清除快捷键",

  // Settings -> Models
  "Connect the providers you use. Keys live in your OS keychain and are used only by Terax.":
    "连接你使用的服务商。密钥保存在操作系统钥匙串中，只有 Terax 会使用。",
  Providers: "服务商",
  Defaults: "默认设置",
  "Chat model": "对话模型",
  Autocomplete: "自动补全",
  Trigger: "触发方式",
  "Remove provider": "移除服务商",
  "Base URL": "基础 URL",
  "Model ID": "模型 ID",
  Context: "上下文",
  "API key": "API 密钥",
  "Remove key": "移除密钥",
  "Optional — leave empty for unauthenticated endpoints":
    "可选。无需鉴权的端点可以留空",
  "Remove endpoint": "移除端点",
  Name: "名称",
  Provider: "服务商",
  Model: "模型",

  // Settings -> Agents
  "Personas and snippets the AI uses. Switch agents from the input bar.":
    "AI 使用的角色与片段。可在输入栏切换代理。",
  Snippets: "片段",
  Edit: "编辑",
  Delete: "删除",
  Icon: "图标",
  Description: "描述",
  Instructions: "指令",
  "Persona & rules. Appended to Terax's core system prompt.":
    "角色与规则，会追加到 Terax 的核心系统提示词之后。",
  Handle: "句柄",
  Content: "内容",
  "Custom instructions": "自定义指令",
  "e.g. Test Engineer": "例如：测试工程师",
  "e.g. Pre-merge review checklist": "例如：合并前检查清单",
  "One line — shown in the agent picker": "一行说明。显示在代理选择器中",
  "One line — shown in the # picker": "一行说明。显示在 # 选择器中",
  "Inserted into the prompt as a <snippet> block when you use #handle.":
    "使用 #句柄 时，作为 <snippet> 块插入提示词。",
  "e.g. Always reply in concise bullet points. Prefer pnpm over npm. My machine is an M-series Mac.":
    "例如：始终用简洁的要点回答。优先使用 pnpm 而不是 npm。我的机器是 M 系列 Mac。",

  // Settings -> shared components
  Replace: "替换",
  "Copy install command": "复制安装命令",
  "Language servers": "语言服务器",
  "Detect again": "重新检测",
  "Remove server": "移除服务器",

  // Settings tabs (General is shared with the section header)
  General: "通用",

  // Shortcut groups
  Tabs: "标签页",
  Spaces: "空间",
  Panes: "窗格",
  View: "视图",

  // Shortcut labels
  "Ask AI about selection": "就选中内容询问 AI",
  "Clear terminal": "清空终端",
  "Close tab or pane": "关闭标签页或窗格",
  "Find in files": "在文件中查找",
  "Find in tab": "在标签页内查找",
  "Focus next pane": "聚焦下一个窗格",
  "Focus previous pane": "聚焦上一个窗格",
  "Go to file": "跳转到文件",
  "Jump to agent needing attention": "跳转到需要处理的代理",
  "Jump to tab 1–9": "跳转到标签页 1–9",
  "New Blocks terminal": "新建 Blocks 终端",
  "New editor tab": "新建编辑器标签页",
  "New private terminal": "新建私有终端",
  "New tab": "新建标签页",
  "New web preview": "新建网页预览",
  "Next command block": "下一个命令块",
  "Next space": "下一个空间",
  "Next tab": "下一个标签页",
  "Open command palette": "打开命令面板",
  "Open settings": "打开设置",
  "Open spaces": "打开空间列表",
  "Previous command block": "上一个命令块",
  "Previous space": "上一个空间",
  "Previous tab": "上一个标签页",
  Redo: "重做",
  "Reset zoom": "重置缩放",
  "Save file": "保存文件",
  "Search files": "搜索文件",
  "Split pane down": "向下拆分窗格",
  "Split pane right": "向右拆分窗格",
  "Swap pane down": "与下方窗格交换",
  "Swap pane left": "与左侧窗格交换",
  "Swap pane right": "与右侧窗格交换",
  "Swap pane up": "与上方窗格交换",
  "Toggle AI agent": "切换 AI 代理",
  "Toggle AI chat window": "切换 AI 对话窗口",
  "Toggle Shell / AI input": "切换 Shell / AI 输入",
  "Toggle file explorer focus": "聚焦文件浏览器",
  "Toggle file explorer": "切换文件浏览器",
  "Toggle hidden files": "切换隐藏文件显示",
  "Toggle source panel": "切换源代码面板",
  "Toggle zen mode": "切换禅模式",
  "Trigger AI completion": "触发 AI 补全",
  "Trigger code completion": "触发代码补全",
  Undo: "撤销",
  "Zoom in": "放大",
  "Zoom out": "缩小",
  Search: "搜索",
  AI: "AI",

  // Command palette
  "Change theme...": "切换主题...",
  "Keyboard shortcuts": "键盘快捷键",
  "Spaces: Overview": "空间：总览",
  "New Space": "新建空间",
  "Switch to {name}": "切换到 {name}",
  "New terminal": "新建终端",
  "New block terminal": "新建块终端",
  "Open git graph": "打开 Git 图",
  "Toggle source control": "切换源代码管理",
  "Find content in files": "在文件中查找内容",
  "Search command history": "搜索命令历史",
  "Find in current tab": "在当前标签页内查找",
  "Search files by name": "按名称搜索文件",
  "Search themes...": "搜索主题...",
  "Go to file... (add :line to jump)": "跳转到文件...（加上 :行号 可直接定位）",
  "Find text in files...": "在文件中查找文本...",
  "Search command history...": "搜索命令历史...",
  "Type a command, / for files, > for history, # to find in files":
    "输入命令，/ 搜索文件，> 搜索历史，# 在文件中查找",
  "No commands found. Type ? to see search modes.":
    "未找到命令。输入 ? 查看搜索模式。",
  Git: "Git",
  Files: "文件",

  "File changed on disk": "文件已在磁盘上变更",
  "{name} was modified by another program while you had unsaved changes. Overwrite to keep your version.":
    "{name} 在你还有未保存更改时被其他程序修改。若要保留你的版本，请选择覆盖。",
  "Open a folder to search its files": "打开一个文件夹以搜索其中的文件",
  "Recent files": "最近的文件",
  "Type a file name": "输入文件名",
  "This URL cannot be loaded in preview.": "此 URL 无法在预览中加载。",
  Overwrite: "覆盖",
  Preview: "预览",
} as const;
