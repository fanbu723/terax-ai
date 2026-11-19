/**
 * Deterministic risk assessment for agent tool calls.
 *
 * Used by the `assisted` permission mode: a tool call whose verdict is `low`
 * executes without a confirmation card; anything else asks. There is no model
 * call here — the rules below are the whole policy, so they are cheap,
 * testable, and never depend on a provider being reachable.
 *
 * Design principles:
 *  - Fail closed: an unrecognized command is `medium`, never `low`.
 *  - Effects, not syntax: `rm -rf build` is destructive even inside the
 *    workspace, so destructive commands always ask.
 *  - Path verdicts are about location: low risk means "a normal file inside
 *    the workspace the user already opened", not "any write".
 *  - `lib/security.ts` remains the hard floor. These verdicts only decide
 *    whether the user is asked; they can never allow a blocked operation.
 */

export type RiskLevel = "low" | "medium" | "high";

export type RiskCode =
  | "read-only"
  | "workspace-path"
  | "project-config"
  | "outside-workspace"
  | "home-config"
  | "system-path"
  | "git-internals"
  | "unknown-location"
  | "read-only-command"
  | "dev-server"
  | "destructive-command"
  | "git-history-rewrite"
  | "force-push"
  | "package-publish"
  | "system-command"
  | "package-install"
  | "git-mutation"
  | "unknown-command"
  | "outside-redirect"
  | "delegated-agent";

export type RiskVerdict = { level: RiskLevel; code: RiskCode };

export type RiskContext = {
  workspaceRoot: string | null;
  cwd: string | null;
};

/** File names whose contents steer builds, CI, or dependency resolution. */
const PROJECT_CONFIG_NAMES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "cargo.toml",
  "cargo.lock",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "tauri.conf.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "biome.json",
  "turbo.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "go.mod",
  "go.sum",
  "pyproject.toml",
  "requirements.txt",
  "environment.yml",
  "makefile",
  "justfile",
]);

const SYSTEM_PREFIXES = [
  "/etc/",
  "/usr/",
  "/bin/",
  "/sbin/",
  "/lib/",
  "/lib64/",
  "/boot/",
  "/dev/",
  "/proc/",
  "/sys/",
  "/private/etc/",
  "/library/",
  "/system/",
  "/private/var/",
  "/var/db/",
  "/var/root/",
  "/windows/",
  "/program files/",
  "/program files (x86)/",
  "/programdata/",
];

/** Dot-directories that hold credentials or tool configuration. */
const HOME_CONFIG_RE =
  /(^|\/)\.(ssh|aws|gnupg|kube|docker|config|npmrc|pypirc|netrc|gitconfig|git-credentials|bashrc|bash_profile|zshrc|profile|claude|codex|gemini|terraform)(\/|$)/;

const GIT_INTERNALS_RE = /(^|\/)\.git(\/|$)/;

/** Split shell chains on top-level separators, respecting quotes/escapes. */
export function splitCommandChain(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | "`" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === "\\" && quote !== "'" && i + 1 < command.length) {
        current += command[++i];
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      current += ch + command[++i];
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === "&&" || two === "||" || two === ">>") {
      out.push(current);
      current = "";
      i++;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "&") {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Strip a leading `VAR=value` chain so `FOO=1 pnpm test` classifies by `pnpm`. */
function stripEnvAssignments(segment: string): string {
  let rest = segment.trimStart();
  while (true) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(?:"[^"]*"|'[^']*'|\S*)\s+/.exec(rest);
    if (!m) return rest;
    rest = rest.slice(m[0].length).trimStart();
  }
}

function firstToken(segment: string): string {
  const cleaned = stripEnvAssignments(segment);
  return cleaned.split(/\s+/)[0] ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeForCompare(input: string): string {
  let p = input.replace(/\\/g, "/");
  p = p.replace(/^[a-zA-Z]:/, "");
  p = p.replace(/\/{2,}/g, "/");
  p = p.toLowerCase();
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function isInside(child: string, root: string): boolean {
  if (!root) return false;
  return child === root || child.startsWith(`${root}/`);
}

function normalizeBases(ctx: RiskContext): string[] {
  return [ctx.workspaceRoot, ctx.cwd]
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .map(normalizeForCompare);
}

function resolveForRisk(rawPath: string, cwd: string | null): string {
  if (!rawPath) return "";
  if (rawPath === "~") return rawPath;
  if (rawPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(rawPath))
    return rawPath;
  if (!cwd) return rawPath;
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  return cwd.endsWith(sep) ? `${cwd}${rawPath}` : `${cwd}${sep}${rawPath}`;
}

function assessPath(
  rawPath: string,
  ctx: RiskContext,
  kind: "file" | "dir",
): RiskVerdict {
  if (!rawPath) return { level: "medium", code: "unknown-location" };
  const abs = resolveForRisk(rawPath, ctx.cwd);
  const cmp = normalizeForCompare(abs);

  if (SYSTEM_PREFIXES.some((prefix) => cmp.startsWith(prefix))) {
    return { level: "high", code: "system-path" };
  }
  if (GIT_INTERNALS_RE.test(cmp)) {
    return { level: "high", code: "git-internals" };
  }
  if (HOME_CONFIG_RE.test(cmp) || cmp.startsWith("/.ssh/")) {
    return { level: "high", code: "home-config" };
  }

  const bases = normalizeBases(ctx);
  if (bases.length === 0) {
    return { level: "medium", code: "unknown-location" };
  }
  if (!bases.some((base) => isInside(cmp, base))) {
    return { level: "high", code: "outside-workspace" };
  }
  if (kind === "dir") return { level: "low", code: "workspace-path" };

  const base = cmp.split("/").pop() ?? "";
  const inProjectConfigDir =
    cmp.includes("/.github/") || cmp.includes("/.gitlab/");
  if (PROJECT_CONFIG_NAMES.has(base) || inProjectConfigDir) {
    return { level: "medium", code: "project-config" };
  }
  return { level: "low", code: "workspace-path" };
}

const DESTRUCTIVE_RE =
  /(^|[\s;&|(])(sudo|doas|rm|rmdir|shred|chmod|chown|kill|pkill|killall)(\s|$)/;

const GIT_HISTORY_RE =
  /\bgit\s+(reset\s+--hard|clean\b|rebase\b|filter-branch\b|checkout\s+--\s+\.|restore\b)/;

const FORCE_PUSH_RE =
  /\bgit\s+push\b[^|;&]*(\s--force(-with-lease)?|\s-f)(\s|$)/;

const PUBLISH_RE = /\b(npm|pnpm|yarn|bun|cargo)\s+publish\b/;

const SYSTEM_COMMAND_RE =
  /(^|[\s;&|(])(systemctl|launchctl|service|crontab|chkconfig|defaults)(\s|$)/;

const DOCKER_DESTRUCTIVE_RE =
  /\bdocker\s+((system|volume|image)\s+prune|rm\b|rmi\b|volume\s+rm\b)/;

const FIND_DELETE_RE = /\bfind\b[^|;&]*(-delete|-exec\s+rm\b|--delete)\b/;

const PIPE_TO_SHELL_RE = /\b(curl|wget)\b[^|;&]*\|\s*(ba|z|k|d|fi|c)?sh\b/;

const DEV_SERVER_RE =
  /(^|\s)(pnpm|npm|yarn|bun)\s+(run\s+)?(dev|start|serve)\b|(^|\s)(vite|next\s+dev|nuxt\s+dev|astro\s+dev|nodemon|webpack\s+--watch|cargo\s+watch|watchexec)\b|(^|\s)tail\s+-f\b|(^|\s)python3?\s+-m\s+http\.server\b/;

const READ_ONLY_COMMANDS = new Set([
  "ls",
  "ll",
  "la",
  "pwd",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "ag",
  "fd",
  "find",
  "sed",
  "awk",
  "sort",
  "uniq",
  "cut",
  "tr",
  "diff",
  "echo",
  "printf",
  "which",
  "type",
  "whoami",
  "date",
  "true",
  "false",
  "test",
  "stat",
  "file",
  "du",
  "df",
  "tree",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "jq",
  "column",
  "less",
  "more",
  "clear",
  "env",
  "uname",
  "id",
  "ps",
  "top",
  "htop",
]);

const BUILD_COMMANDS = new Set([
  "tsc",
  "biome",
  "eslint",
  "prettier",
  "vitest",
  "jest",
  "pytest",
  "ruff",
  "mypy",
  "golangci-lint",
  "shfmt",
  "zig",
  "make",
  "just",
  "cmake",
  "ninja",
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "blame",
  "branch",
  "remote",
  "tag",
  "describe",
  "rev-parse",
  "ls-files",
  "grep",
  "shortlog",
  "whatchanged",
]);

const LOW_PACKAGE_SUBCOMMANDS = new Set([
  "test",
  "lint",
  "typecheck",
  "type-check",
  "check",
  "build",
  "format",
  "fmt",
  "exec",
]);

const LOW_SCRIPTS = new Set([
  "test",
  "tests",
  "lint",
  "typecheck",
  "type-check",
  "types",
  "build",
  "format",
  "check",
  "ci",
]);

const LOW_CARGO_SUBCOMMANDS = new Set([
  "test",
  "check",
  "clippy",
  "fmt",
  "build",
  "doc",
  "bench",
]);

const PACKAGE_INSTALL_RE =
  /\b(pnpm|npm|yarn|bun)\s+(install|i|add|remove|rm|uninstall|update|upgrade|dlx|create)\b/;

const GIT_MUTATION_RE =
  /\bgit\s+(add|commit|checkout|switch|merge|push|pull|fetch|stash|cherry-pick|revert|mv|rm|apply|am|tag\s+-d)\b/;

const REDIRECT_RE = /(^|[^>])>>?\s*([^\s;&|]+)/g;

function classifyRedirects(
  command: string,
  ctx: RiskContext,
): RiskVerdict | null {
  REDIRECT_RE.lastIndex = 0;
  let match: RegExpExecArray | null = REDIRECT_RE.exec(command);
  while (match) {
    const target = match[2];
    if (target && !target.startsWith("&") && target !== "/dev/null") {
      const verdict = assessPath(target, ctx, "file");
      if (verdict.level !== "low") return verdict;
      return { level: "medium", code: "unknown-command" };
    }
    match = REDIRECT_RE.exec(command);
  }
  return null;
}

function classifySegment(segment: string, ctx: RiskContext): RiskVerdict {
  const command = segment.trim();
  if (!command) return { level: "low", code: "read-only-command" };

  if (PIPE_TO_SHELL_RE.test(command)) {
    return { level: "high", code: "destructive-command" };
  }
  if (DESTRUCTIVE_RE.test(command)) {
    return { level: "high", code: "destructive-command" };
  }
  if (GIT_HISTORY_RE.test(command)) {
    return { level: "high", code: "git-history-rewrite" };
  }
  if (FORCE_PUSH_RE.test(command)) {
    return { level: "high", code: "force-push" };
  }
  if (PUBLISH_RE.test(command)) {
    return { level: "high", code: "package-publish" };
  }
  if (SYSTEM_COMMAND_RE.test(command)) {
    return { level: "high", code: "system-command" };
  }
  if (DOCKER_DESTRUCTIVE_RE.test(command)) {
    return { level: "high", code: "destructive-command" };
  }
  if (FIND_DELETE_RE.test(command)) {
    return { level: "high", code: "destructive-command" };
  }

  const redirect = classifyRedirects(command, ctx);
  if (redirect) return redirect;

  const token = firstToken(command);
  const normalized = token.replace(/^[({!]+/, "").replace(/^["']|["']$/g, "");

  if (/^sed\b/.test(normalized) && /\s-i(\s|$)/.test(command)) {
    return { level: "medium", code: "unknown-command" };
  }
  if (READ_ONLY_COMMANDS.has(normalized)) {
    return { level: "low", code: "read-only-command" };
  }
  if (BUILD_COMMANDS.has(normalized)) {
    return { level: "low", code: "read-only-command" };
  }

  if (normalized === "git") {
    const sub = command.trim().split(/\s+/)[1] ?? "";
    if (READ_ONLY_GIT_SUBCOMMANDS.has(sub)) {
      return { level: "low", code: "read-only-command" };
    }
    if (GIT_MUTATION_RE.test(command)) {
      return { level: "medium", code: "git-mutation" };
    }
    return { level: "medium", code: "git-mutation" };
  }

  if (
    normalized === "pnpm" ||
    normalized === "npm" ||
    normalized === "yarn" ||
    normalized === "bun"
  ) {
    const rest = command.trim().split(/\s+/).slice(1);
    const sub = (rest.find((part) => !part.startsWith("-")) ?? "").replace(
      /:$/,
      "",
    );
    if (LOW_PACKAGE_SUBCOMMANDS.has(sub)) {
      if (sub === "exec") return { level: "medium", code: "unknown-command" };
      return { level: "low", code: "read-only-command" };
    }
    if (sub === "run" || sub === "run-script") {
      const script =
        rest.slice(rest.indexOf(sub) + 1).find((p) => !p.startsWith("-")) ?? "";
      if (LOW_SCRIPTS.has(script)) {
        return { level: "low", code: "read-only-command" };
      }
      return { level: "medium", code: "unknown-command" };
    }
    if (sub === "test" || sub === "lint" || sub === "build") {
      return { level: "low", code: "read-only-command" };
    }
    if (PACKAGE_INSTALL_RE.test(command)) {
      return { level: "medium", code: "package-install" };
    }
    return { level: "medium", code: "unknown-command" };
  }

  if (normalized === "cargo") {
    const sub = command.trim().split(/\s+/)[1] ?? "";
    if (LOW_CARGO_SUBCOMMANDS.has(sub)) {
      return { level: "low", code: "read-only-command" };
    }
    if (sub === "run") return { level: "medium", code: "unknown-command" };
    if (sub === "add" || sub === "install" || sub === "update") {
      return { level: "medium", code: "package-install" };
    }
    return { level: "medium", code: "unknown-command" };
  }

  if (normalized === "go") {
    const sub = command.trim().split(/\s+/)[1] ?? "";
    if (sub === "test" || sub === "build" || sub === "vet" || sub === "list") {
      return { level: "low", code: "read-only-command" };
    }
    return { level: "medium", code: "unknown-command" };
  }

  if (
    normalized === "python" ||
    normalized === "python3" ||
    normalized === "py"
  ) {
    if (/\s(-V|--version)(\s|$)/.test(command)) {
      return { level: "low", code: "read-only-command" };
    }
    if (/\s-m\s+(pytest|unittest|compileall)\b/.test(command)) {
      return { level: "low", code: "read-only-command" };
    }
    return { level: "medium", code: "unknown-command" };
  }

  if (normalized === "pip" || normalized === "pip3") {
    const sub = command.trim().split(/\s+/)[1] ?? "";
    if (
      sub === "-V" ||
      sub === "--version" ||
      sub === "list" ||
      sub === "show" ||
      sub === "freeze"
    ) {
      return { level: "low", code: "read-only-command" };
    }
    if (sub === "install" || sub === "uninstall" || sub === "download") {
      return { level: "medium", code: "package-install" };
    }
    return { level: "medium", code: "unknown-command" };
  }

  if (normalized === "node") {
    if (/\s(-v|--version)(\s|$)/.test(command)) {
      return { level: "low", code: "read-only-command" };
    }
    return { level: "medium", code: "unknown-command" };
  }

  return { level: "medium", code: "unknown-command" };
}

const LEVEL_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function worst(verdicts: RiskVerdict[]): RiskVerdict {
  return verdicts.reduce((acc, v) =>
    LEVEL_ORDER[v.level] > LEVEL_ORDER[acc.level] ? v : acc,
  );
}

export function assessCommandRisk(
  command: string,
  ctx: RiskContext,
): RiskVerdict {
  const trimmed = command.trim();
  if (!trimmed) return { level: "medium", code: "unknown-command" };
  const segments = splitCommandChain(trimmed);
  if (segments.length === 0) {
    return { level: "medium", code: "unknown-command" };
  }
  if (/\$\(|`/.test(trimmed)) {
    // Command substitution can hide effects; never auto-approve it.
    return { level: "medium", code: "unknown-command" };
  }
  return worst(segments.map((segment) => classifySegment(segment, ctx)));
}

function assessBackgroundRisk(
  command: string,
  ctx: RiskContext,
  explicitCwd: string,
): RiskVerdict {
  const cwdCtx: RiskContext = {
    workspaceRoot: ctx.workspaceRoot,
    cwd: explicitCwd || ctx.cwd,
  };
  const verdict = assessCommandRisk(command, cwdCtx);
  if (verdict.level === "high") return verdict;
  // A recognized dev server is the routine background case; `pnpm dev` is
  // medium as a foreground command only because arbitrary `dev` scripts are
  // unknown, and that reason does not apply to a managed background process.
  if (DEV_SERVER_RE.test(command)) {
    return { level: "low", code: "dev-server" };
  }
  return verdict.level === "low"
    ? { level: "medium", code: "unknown-command" }
    : verdict;
}

/** Extra tools that never execute without a card, regardless of input. */
const ALWAYS_MEDIUM = new Set(["spawn_coding_agent", "send_to_agent"]);

export function assessToolRisk(
  toolName: string,
  input: unknown,
  ctx: RiskContext,
): RiskVerdict {
  if (ALWAYS_MEDIUM.has(toolName)) {
    return { level: "medium", code: "delegated-agent" };
  }
  if (!isRecord(input)) return { level: "medium", code: "unknown-location" };

  switch (toolName) {
    case "write_file":
    case "edit":
    case "multi_edit":
      return assessPath(str(input.path), ctx, "file");
    case "create_directory":
      return assessPath(str(input.path), ctx, "dir");
    case "bash_run":
      return assessCommandRisk(str(input.command), ctx);
    case "bash_background":
      return assessBackgroundRisk(str(input.command), ctx, str(input.cwd));
    default:
      return { level: "low", code: "read-only" };
  }
}
