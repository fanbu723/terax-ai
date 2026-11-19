import { describe, expect, it } from "vitest";
import {
  assessCommandRisk,
  assessToolRisk,
  splitCommandChain,
  type RiskContext,
} from "./risk";

const WORKSPACE: RiskContext = {
  workspaceRoot: "/home/u/proj",
  cwd: "/home/u/proj/src",
};

describe("splitCommandChain", () => {
  it("splits on top-level separators", () => {
    expect(splitCommandChain("pnpm test && rm -rf dist")).toEqual([
      "pnpm test",
      "rm -rf dist",
    ]);
    expect(splitCommandChain("a; b | c || d")).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps separators inside quotes", () => {
    expect(splitCommandChain("echo 'a && b' | cat")).toEqual([
      "echo 'a && b'",
      "cat",
    ]);
  });
});

describe("path risk", () => {
  it.each([
    ["/home/u/proj/src/a.ts", "low", "workspace-path"],
    ["/home/u/proj/src/new", "low", "workspace-path"],
    ["src/a.ts", "low", "workspace-path"],
    ["/home/u/proj/package.json", "medium", "project-config"],
    ["/home/u/proj/.github/workflows/ci.yml", "medium", "project-config"],
    ["/home/u/other/a.ts", "high", "outside-workspace"],
    ["/etc/hosts", "high", "system-path"],
    ["/home/u/proj/.git/config", "high", "git-internals"],
    ["~/.ssh/config", "high", "home-config"],
    ["/home/u/.config/foo", "high", "home-config"],
  ])("write_file %s -> %s/%s", (path, level, code) => {
    expect(assessToolRisk("write_file", { path }, WORKSPACE)).toEqual({
      level,
      code,
    });
  });

  it("treats a directory create inside the workspace as low", () => {
    expect(
      assessToolRisk(
        "create_directory",
        { path: "/home/u/proj/new-dir" },
        WORKSPACE,
      ),
    ).toEqual({ level: "low", code: "workspace-path" });
  });

  it("fails closed when no workspace or cwd is known", () => {
    expect(
      assessToolRisk(
        "write_file",
        { path: "relative.txt" },
        { workspaceRoot: null, cwd: null },
      ),
    ).toEqual({ level: "medium", code: "unknown-location" });
  });

  it("accepts paths inside the cwd even without a workspace root", () => {
    expect(
      assessToolRisk(
        "edit",
        { path: "/home/u/proj/src/a.ts" },
        { workspaceRoot: null, cwd: "/home/u/proj" },
      ),
    ).toEqual({ level: "low", code: "workspace-path" });
  });
});

describe("command risk", () => {
  it.each([
    ["ls -la", "low", "read-only-command"],
    ["pnpm test", "low", "read-only-command"],
    ["pnpm run lint", "low", "read-only-command"],
    ["cargo test --locked", "low", "read-only-command"],
    ["git status", "low", "read-only-command"],
    ["git diff HEAD~1", "low", "read-only-command"],
    ["rg approval src", "low", "read-only-command"],
    ["find . -name '*.ts'", "low", "read-only-command"],
    ["rm -rf build", "high", "destructive-command"],
    ["sudo apt install curl", "high", "destructive-command"],
    ["chmod -R 777 .", "high", "destructive-command"],
    ["git reset --hard HEAD~1", "high", "git-history-rewrite"],
    ["git clean -fd", "high", "git-history-rewrite"],
    ["git push --force origin main", "high", "force-push"],
    ["git push -f", "high", "force-push"],
    ["npm publish", "high", "package-publish"],
    ["systemctl restart nginx", "high", "system-command"],
    ["docker system prune", "high", "destructive-command"],
    ["find . -name '*.log' -delete", "high", "destructive-command"],
    ["pnpm add zod", "medium", "package-install"],
    ["pip install requests", "medium", "package-install"],
    ["git commit -m wip", "medium", "git-mutation"],
    ["some-unknown-tool --flag", "medium", "unknown-command"],
    ["node server.js", "medium", "unknown-command"],
    ["sed -i s/a/b/ file.txt", "medium", "unknown-command"],
    ["pnpm test && rm -rf dist", "high", "destructive-command"],
    ["ls | rm -rf x", "high", "destructive-command"],
  ])("%s -> %s/%s", (command, level, code) => {
    expect(assessCommandRisk(command, WORKSPACE)).toEqual({ level, code });
  });

  it("asks when a redirect points outside the workspace", () => {
    expect(
      assessCommandRisk("echo hi > /home/u/other/out.txt", WORKSPACE).level,
    ).toBe("high");
    expect(assessCommandRisk("echo hi > /dev/null", WORKSPACE)).toEqual({
      level: "low",
      code: "read-only-command",
    });
  });

  it("never auto-approves command substitution", () => {
    expect(assessCommandRisk("echo $(date)", WORKSPACE)).toEqual({
      level: "medium",
      code: "unknown-command",
    });
  });
});

describe("background command risk", () => {
  it("treats dev servers as low", () => {
    expect(
      assessToolRisk("bash_background", { command: "pnpm dev" }, WORKSPACE),
    ).toEqual({ level: "low", code: "dev-server" });
  });

  it("still refuses to auto-approve destructive background processes", () => {
    expect(
      assessToolRisk("bash_background", { command: "rm -rf dist" }, WORKSPACE),
    ).toEqual({ level: "high", code: "destructive-command" });
  });

  it("asks for other background processes", () => {
    expect(
      assessToolRisk(
        "bash_background",
        { command: "node server.js" },
        WORKSPACE,
      ),
    ).toEqual({ level: "medium", code: "unknown-command" });
  });
});

describe("delegated agents", () => {
  it.each(["spawn_coding_agent", "send_to_agent"])(
    "%s always asks",
    (toolName) => {
      expect(assessToolRisk(toolName, {}, WORKSPACE)).toEqual({
        level: "medium",
        code: "delegated-agent",
      });
    },
  );
});
