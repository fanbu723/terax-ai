import { describe, expect, it } from "vitest";
import { labelFor } from "./tabLabel";
import type {
  AiDiffTab,
  GitCommitFileDiffTab,
  GitHistoryTab,
  TerminalTab,
} from "./useTabs";

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
    ...over,
  };
}

function gitHistoryTab(over: Partial<GitHistoryTab> = {}): GitHistoryTab {
  return {
    id: 3,
    kind: "git-history",
    spaceId: "default",
    title: "Git History",
    repoRoot: "/Users/me/repo",
    ...over,
  };
}

function aiDiffTab(over: Partial<AiDiffTab> = {}): AiDiffTab {
  return {
    id: 4,
    kind: "ai-diff",
    spaceId: "default",
    title: "index.ts (AI diff)",
    path: "/Users/me/repo/index.ts",
    originalContent: "",
    proposedContent: "",
    approvalId: "approval",
    status: "pending",
    isNewFile: false,
    ...over,
  };
}

function gitCommitFileTab(
  over: Partial<GitCommitFileDiffTab> = {},
): GitCommitFileDiffTab {
  return {
    id: 5,
    kind: "git-commit-file",
    spaceId: "default",
    title: "index.ts @ a1b2c3d",
    repoRoot: "/Users/me/repo",
    sha: "a1b2c3d4",
    shortSha: "a1b2c3d",
    subject: "fix: thing",
    path: "index.ts",
    originalPath: null,
    ...over,
  };
}

describe("labelFor (terminal tabs)", () => {
  it("derives the label from the last cwd segment", () => {
    expect(labelFor(terminalTab({ cwd: "/Users/me/projects/terax-ai" }))).toBe(
      "terax-ai",
    );
  });

  it("translates the default terminal fallback when there is no cwd", () => {
    expect(labelFor(terminalTab())).toBe("Terminal");
  });

  it("translates the Blocks terminal fallback", () => {
    expect(labelFor(terminalTab({ title: "blocks", blocks: true }))).toBe(
      "Blocks terminal",
    );
  });

  it("translates the private terminal fallback", () => {
    expect(labelFor(terminalTab({ title: "private", private: true }))).toBe(
      "Private terminal",
    );
  });

  it("prefers a custom title over the cwd-derived name", () => {
    expect(
      labelFor(
        terminalTab({
          cwd: "/Users/me/projects/terax-ai",
          customTitle: "Server",
        }),
      ),
    ).toBe("Server");
  });

  it("keeps the custom title after the cwd changes (survives cd)", () => {
    const renamed = terminalTab({ cwd: "/Users/me/a", customTitle: "Server" });
    const afterCd = { ...renamed, cwd: "/Users/me/b/c" };
    expect(labelFor(afterCd)).toBe("Server");
  });

  it("handles Windows-style cwd separators", () => {
    expect(labelFor(terminalTab({ cwd: "C:\\Users\\me\\proj" }))).toBe("proj");
  });
});

describe("labelFor (stored titles that are UI copy)", () => {
  it("translates the fixed Git History title", () => {
    expect(labelFor(gitHistoryTab())).toBe("Git History");
  });

  it("translates the History · <branch> title and keeps the branch name", () => {
    expect(labelFor(gitHistoryTab({ title: "History · feat/i18n-zh" }))).toBe(
      "History · feat/i18n-zh",
    );
  });

  it("translates only the AI diff suffix, keeping the file name", () => {
    expect(labelFor(aiDiffTab())).toBe("index.ts (AI diff)");
    expect(labelFor(aiDiffTab({ title: "my file.ts (AI diff)" }))).toBe(
      "my file.ts (AI diff)",
    );
  });

  it("leaves a commit title with its sha untouched", () => {
    expect(labelFor(gitCommitFileTab())).toBe("index.ts @ a1b2c3d");
  });

  it("leaves user custom titles untouched", () => {
    expect(labelFor(terminalTab({ customTitle: "Deploy" }))).toBe("Deploy");
  });
});
