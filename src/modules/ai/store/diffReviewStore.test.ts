import { beforeEach, describe, expect, it } from "vitest";
import {
  clearApprovalDecisions,
  recordApprovalDecision,
} from "../lib/approvalDecisions";
import { usePlanStore } from "./planStore";
import { autoDiffFor, useDiffReviewStore } from "./diffReviewStore";

function entry(toolCallId: string) {
  return {
    toolCallId,
    sessionId: "session",
    path: "/workspace/a.ts",
    originalContent: "a",
    proposedContent: "b",
    isNewFile: false,
    level: "low" as const,
    code: "workspace-path" as const,
  };
}

beforeEach(() => {
  useDiffReviewStore.getState().clear();
  clearApprovalDecisions();
  usePlanStore.setState({ active: false, queue: [] });
});

describe("diff review store", () => {
  it("records an entry with a timestamp", () => {
    useDiffReviewStore.getState().record(entry("call-1"));
    const [recorded] = useDiffReviewStore.getState().entries;
    expect(recorded).toMatchObject(entry("call-1"));
    expect(recorded.at).toBeTypeOf("number");
  });

  it("replaces an entry with the same toolCallId", () => {
    useDiffReviewStore.getState().record(entry("call-1"));
    useDiffReviewStore.getState().record({
      ...entry("call-1"),
      proposedContent: "c",
    });
    expect(useDiffReviewStore.getState().entries).toHaveLength(1);
    expect(useDiffReviewStore.getState().entries[0].proposedContent).toBe("c");
  });

  it("keeps only the newest entries", () => {
    for (let i = 0; i < 60; i++) {
      useDiffReviewStore.getState().record(entry(`call-${i}`));
    }
    const entries = useDiffReviewStore.getState().entries;
    expect(entries).toHaveLength(50);
    expect(entries[0].toolCallId).toBe("call-10");
    expect(entries[entries.length - 1].toolCallId).toBe("call-59");
  });
});

describe("autoDiffFor", () => {
  it("returns the verdict for an auto-approved call", () => {
    recordApprovalDecision("call-1", {
      toolName: "write_file",
      required: false,
      level: "low",
      code: "workspace-path",
    });
    expect(autoDiffFor("call-1", "session")).toEqual({
      level: "low",
      code: "workspace-path",
    });
  });

  it("ignores calls the user had to approve", () => {
    recordApprovalDecision("call-1", {
      toolName: "write_file",
      required: true,
      level: "low",
      code: "workspace-path",
    });
    expect(autoDiffFor("call-1", "session")).toBeNull();
  });

  it("ignores plan-mode queueing", () => {
    recordApprovalDecision("call-1", {
      toolName: "write_file",
      required: false,
      level: "low",
      code: "workspace-path",
    });
    usePlanStore.setState({ active: true });
    expect(autoDiffFor("call-1", "session")).toBeNull();
  });

  it("needs both a call id and a session", () => {
    expect(autoDiffFor(null, "session")).toBeNull();
    expect(autoDiffFor("call-1", null)).toBeNull();
  });
});
