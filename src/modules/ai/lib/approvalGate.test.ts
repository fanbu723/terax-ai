import { beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => ({ agentPermissionMode: "assisted" }));

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ agentPermissionMode: prefs.agentPermissionMode }),
  },
}));

import {
  clearApprovalDecisions,
  getApprovalDecision,
} from "./approvalDecisions";
import { approvalFor } from "./approvalGate";
import { usePermissionStore } from "../store/permissionStore";

const ctx = {
  getCwd: () => "/home/u/proj/src",
  getWorkspaceRoot: () => "/home/u/proj",
  getSessionId: () => "session-1",
};

function run(
  toolName: Parameters<typeof approvalFor>[0],
  input: unknown,
  toolCallId = "call-1",
): boolean {
  return approvalFor(toolName, ctx)(input, { toolCallId });
}

beforeEach(() => {
  prefs.agentPermissionMode = "assisted";
  usePermissionStore.getState().reset();
  clearApprovalDecisions();
});

describe("manual mode", () => {
  it("always asks, even for low-risk edits", () => {
    prefs.agentPermissionMode = "manual";
    expect(run("write_file", { path: "/home/u/proj/src/a.ts" })).toBe(true);
    expect(run("bash_run", { command: "pnpm test" })).toBe(true);
  });

  it("still records the risk verdict for the card", () => {
    prefs.agentPermissionMode = "manual";
    run("write_file", { path: "/home/u/proj/src/a.ts" }, "call-manual");
    expect(getApprovalDecision("call-manual")).toEqual({
      toolName: "write_file",
      required: true,
      level: "low",
      code: "workspace-path",
    });
  });
});

describe("assisted mode", () => {
  it("auto-approves low-risk workspace mutations", () => {
    expect(run("write_file", { path: "/home/u/proj/src/a.ts" })).toBe(false);
    expect(getApprovalDecision("call-1")?.required).toBe(false);
  });

  it("asks for high-risk commands", () => {
    expect(run("bash_run", { command: "rm -rf build" })).toBe(true);
    expect(run("bash_run", { command: "git push --force" })).toBe(true);
  });

  it("asks for project configuration edits", () => {
    expect(run("edit", { path: "/home/u/proj/package.json" })).toBe(true);
  });

  it("asks for outside-workspace writes", () => {
    expect(run("write_file", { path: "/home/u/other/a.ts" })).toBe(true);
  });

  it("asks for delegated agents", () => {
    expect(run("spawn_coding_agent", { prompt: "fix it" })).toBe(true);
  });
});

describe("allow-all mode", () => {
  it("never asks", () => {
    usePermissionStore.getState().setMode("session-1", "allow-all");
    expect(run("bash_run", { command: "rm -rf build" })).toBe(false);
    expect(run("write_file", { path: "/etc/hosts" })).toBe(false);
    expect(run("spawn_coding_agent", { prompt: "go" })).toBe(false);
  });
});

describe("session overrides", () => {
  it("applies the override to its own session only", () => {
    usePermissionStore.getState().setMode("session-1", "allow-all");
    const otherCtx = { ...ctx, getSessionId: () => "session-2" };
    expect(
      approvalFor("write_file", otherCtx)({ path: "/home/u/proj/a.ts" }),
    ).toBe(false);
    expect(
      approvalFor("write_file", otherCtx)(
        { path: "/home/u/other/a.ts" },
        { toolCallId: "call-2" },
      ),
    ).toBe(true);
  });
});

describe("decision bookkeeping", () => {
  it("tolerates a missing toolCallId", () => {
    expect(
      approvalFor("write_file", ctx)({ path: "/home/u/proj/a.ts" }, {}),
    ).toBe(false);
  });
});
