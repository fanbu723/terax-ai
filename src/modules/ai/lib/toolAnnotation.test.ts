import type { TFunction } from "@/i18n";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearApprovalDecisions,
  recordApprovalDecision,
} from "./approvalDecisions";
import { toolAnnotation } from "./toolAnnotation";

/** Minimal t(): interpolates `{name}` placeholders, leaves copy as-is. */
const t = ((key: string, vars?: Record<string, unknown>) =>
  key.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars?.[name] ?? ""),
  )) as TFunction;

beforeEach(() => {
  clearApprovalDecisions();
});

describe("toolAnnotation", () => {
  it("annotates an auto-approved write", () => {
    recordApprovalDecision("call-1", {
      toolName: "write_file",
      required: false,
      level: "low",
      code: "workspace-path",
    });
    expect(
      toolAnnotation(
        "write_file",
        { path: "/workspace/src/a.ts" },
        "call-1",
        "output-available",
        t,
      ),
    ).toBe("Write a.ts · Auto-approved (Low risk)");
  });

  it("marks a pending high-risk command", () => {
    recordApprovalDecision("call-2", {
      toolName: "bash_run",
      required: true,
      level: "high",
      code: "destructive-command",
    });
    expect(
      toolAnnotation(
        "bash_run",
        { command: "rm -rf build" },
        "call-2",
        "approval-requested",
        t,
      ),
    ).toBe("Run rm -rf build · Awaiting confirmation (High risk)");
  });

  it("marks a denied call", () => {
    expect(
      toolAnnotation("edit", { path: "a.ts" }, "call-3", "output-denied", t),
    ).toBe("Edit a.ts · Denied");
  });

  it("compacts long commands", () => {
    const command = `echo ${"x".repeat(120)}`;
    expect(
      toolAnnotation("bash_run", { command }, null, "output-available", t),
    ).toMatch(/^Run echo x+…$/);
  });

  it("does not annotate read-only tools", () => {
    expect(
      toolAnnotation(
        "read_file",
        { path: "/workspace/a.ts" },
        "c",
        "output-available",
        t,
      ),
    ).toBeNull();
  });

  it("falls back to the action when no decision was recorded", () => {
    expect(
      toolAnnotation(
        "edit",
        { path: "a.ts" },
        "missing",
        "output-available",
        t,
      ),
    ).toBe("Edit a.ts");
  });
});
