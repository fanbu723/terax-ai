import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const nativeMock = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  createDir: vi.fn(),
}));
vi.mock("../lib/native", () => ({ native: nativeMock }));

import { usePlanStore } from "../store/planStore";
import { useDiffReviewStore } from "../store/diffReviewStore";
import { clearApprovalDecisions } from "../lib/approvalDecisions";
import { buildFsTools } from "./fs";

const options: ToolExecutionOptions = { toolCallId: "write", messages: [] };
const context: ToolContext = {
  getCwd: () => "/workspace",
  getWorkspaceRoot: () => "/workspace",
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  openPreview: () => false,
  spawnAgent: () => null,
  readAgentOutput: () => null,
  readCache: new Map(),
  getSessionId: () => "session",
};

async function queueWrite() {
  const execute = buildFsTools(context).write_file.execute;
  if (!execute) throw new Error("missing write tool");
  return execute(
    { path: "/workspace/file.txt", content: "replacement" },
    options,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlanStore.setState({ active: true, queue: [] });
  useDiffReviewStore.getState().clear();
  clearApprovalDecisions();
});

it.each([
  "AI path is outside the authorized workspace",
  "Permission denied (os error 13)",
  new Error("snapshot failed"),
])("does not queue an overwrite when the snapshot fails: %s", async (error) => {
  nativeMock.readFile.mockRejectedValue(error);
  expect(await queueWrite()).toMatchObject({ error: String(error) });
  expect(usePlanStore.getState().queue).toEqual([]);
  await usePlanStore.getState().applyAll();
  expect(nativeMock.writeFile).not.toHaveBeenCalled();
});

it.each([
  { kind: "binary", size: 20 },
  { kind: "toolarge", size: 100, limit: 10 },
])("does not queue an unreadable $kind snapshot", async (result) => {
  nativeMock.readFile.mockResolvedValue(result);
  expect(await queueWrite()).toHaveProperty("error");
  expect(usePlanStore.getState().queue).toEqual([]);
});

it("keeps a known missing file creatable in plan mode", async () => {
  nativeMock.readFile.mockRejectedValue("AI file not found");
  expect(await queueWrite()).toMatchObject({ queued_for_plan_review: true });
  expect(usePlanStore.getState().queue[0]).toMatchObject({
    originalContent: "",
    proposedContent: "replacement",
    isNewFile: true,
  });
});

it.each(["original", ""])(
  "preserves an existing snapshot, including empty files",
  async (content) => {
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content,
      size: content.length,
    });
    expect(await queueWrite()).toMatchObject({ queued_for_plan_review: true });
    expect(usePlanStore.getState().queue[0]).toMatchObject({
      originalContent: content,
      proposedContent: "replacement",
      isNewFile: false,
    });
  },
);

describe("auto-approved writes", () => {
  async function autoWrite(toolCallId: string) {
    usePlanStore.setState({ active: false, queue: [] });
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content: "original",
      size: 8,
    });
    const tools = buildFsTools(context);
    const needsApproval = tools.write_file.needsApproval as unknown as (
      input: unknown,
      options: { toolCallId: string },
    ) => boolean;
    const input = { path: "/workspace/file.txt", content: "replacement" };
    expect(needsApproval(input, { toolCallId })).toBe(false);
    const execute = tools.write_file.execute;
    if (!execute) throw new Error("missing write tool");
    await execute(input, { toolCallId, messages: [] });
    return useDiffReviewStore
      .getState()
      .entries.find((entry) => entry.toolCallId === toolCallId);
  }

  it("records a before/after snapshot for the review tab", async () => {
    const entry = await autoWrite("auto-write");
    expect(entry).toMatchObject({
      sessionId: "session",
      path: "/workspace/file.txt",
      originalContent: "original",
      proposedContent: "replacement",
      isNewFile: false,
      level: "low",
    });
  });

  it("records a new file as an empty original", async () => {
    usePlanStore.setState({ active: false, queue: [] });
    nativeMock.readFile.mockRejectedValue("AI file not found");
    const tools = buildFsTools(context);
    const toolCallId = "auto-new";
    (
      tools.write_file.needsApproval as unknown as (
        input: unknown,
        options: { toolCallId: string },
      ) => boolean
    )({ path: "/workspace/new.txt" }, { toolCallId });
    const execute = tools.write_file.execute;
    if (!execute) throw new Error("missing write tool");
    await execute(
      { path: "/workspace/new.txt", content: "hello" },
      { toolCallId, messages: [] },
    );
    expect(
      useDiffReviewStore
        .getState()
        .entries.find((entry) => entry.toolCallId === toolCallId),
    ).toMatchObject({ originalContent: "", isNewFile: true });
  });

  it("does not record plan-mode writes", async () => {
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content: "original",
      size: 8,
    });
    const tools = buildFsTools(context);
    const toolCallId = "plan-write";
    (
      tools.write_file.needsApproval as unknown as (
        input: unknown,
        options: { toolCallId: string },
      ) => boolean
    )({ path: "/workspace/file.txt", content: "replacement" }, { toolCallId });
    const execute = tools.write_file.execute;
    if (!execute) throw new Error("missing write tool");
    await execute(
      { path: "/workspace/file.txt", content: "replacement" },
      { toolCallId, messages: [] },
    );
    expect(useDiffReviewStore.getState().entries).toEqual([]);
  });
});
