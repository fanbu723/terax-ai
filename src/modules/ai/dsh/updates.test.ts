import { describe, expect, it } from "vitest";
import {
  appendNotice,
  appendUserTurn,
  applyDshUpdate,
  createDshSessionState,
  setPromptRunning,
} from "./updates";

const text = (value: string) => ({ type: "text" as const, text: value });

describe("applyDshUpdate", () => {
  it("merges assistant chunks into the last message", () => {
    let state = createDshSessionState("s");
    state = applyDshUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: text("Hello"),
    });
    state = applyDshUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: text(", world"),
    });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      kind: "assistant",
      text: "Hello, world",
    });
  });

  it("starts a new assistant message after a tool call", () => {
    let state = createDshSessionState("s");
    state = applyDshUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: text("before"),
    });
    state = applyDshUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Run tests",
      status: "pending",
    });
    state = applyDshUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: text("after"),
    });
    expect(state.items.map((item) => item.kind)).toEqual([
      "assistant",
      "tool",
      "assistant",
    ]);
  });

  it("merges tool updates by id", () => {
    let state = createDshSessionState("s");
    state = applyDshUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Read file",
      status: "pending",
      content: [{ type: "content", content: text("a.ts") }],
    });
    state = applyDshUpdate(state, {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      content: [{ type: "diff", path: "a.ts", oldText: "", newText: "x" }],
    });
    const tool = state.items[0];
    expect(tool).toMatchObject({
      kind: "tool",
      toolCallId: "t1",
      title: "Read file",
      status: "completed",
      preview: "diff a.ts",
    });
  });

  it("replaces the plan and clears it on plan_removed", () => {
    let state = createDshSessionState("s");
    state = applyDshUpdate(state, {
      sessionUpdate: "plan",
      entries: [
        { content: "Explore", priority: "high", status: "in_progress" },
      ],
    });
    expect(state.plan?.entries).toHaveLength(1);
    state = applyDshUpdate(state, {
      sessionUpdate: "plan_update",
      plan: {
        type: "items",
        planId: "main",
        entries: [
          { content: "Explore", priority: "high", status: "completed" },
          { content: "Implement", priority: "medium", status: "pending" },
        ],
      },
    });
    expect(state.plan?.entries).toHaveLength(2);
    state = applyDshUpdate(state, {
      sessionUpdate: "plan_update",
      plan: { type: "markdown", planId: "main", content: "# Plan" },
    });
    expect(state.plan?.markdown).toBe("# Plan");
    state = applyDshUpdate(state, {
      sessionUpdate: "plan_removed",
      planId: "main",
    });
    expect(state.plan).toBeNull();
  });

  it("tracks commands, config options, usage and title", () => {
    let state = createDshSessionState("s");
    state = applyDshUpdate(state, {
      sessionUpdate: "available_commands_update",
      availableCommands: [
        { name: "plan", description: "Toggle plan mode" },
      ],
    });
    state = applyDshUpdate(state, {
      sessionUpdate: "config_option_update",
      configOptions: [],
    });
    state = applyDshUpdate(state, {
      sessionUpdate: "usage_update",
      used: 1200,
      size: 200000,
    });
    state = applyDshUpdate(state, {
      sessionUpdate: "session_info_update",
      title: "Fix the parser",
    });
    expect(state.commands).toEqual([
      { name: "plan", description: "Toggle plan mode" },
    ]);
    expect(state.usage).toEqual({ used: 1200, size: 200000 });
    expect(state.title).toBe("Fix the parser");
  });

  it("ignores echoes and unknown updates", () => {
    let state = createDshSessionState("s");
    state = applyDshUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: text("hi"),
    });
    state = applyDshUpdate(state, {
      sessionUpdate: "compaction_summary_chunk",
      content: text("summary"),
    } as never);
    expect(state.items).toHaveLength(0);
  });
});

describe("session helpers", () => {
  it("appends user turns and toggles the busy flag", () => {
    let state = createDshSessionState("s");
    state = appendUserTurn(state, "please fix this");
    state = setPromptRunning(state, true);
    expect(state.items[0]).toMatchObject({
      kind: "user",
      text: "please fix this",
    });
    expect(state.busy).toBe(true);
    state = setPromptRunning(state, false, "end_turn");
    expect(state.busy).toBe(false);
    expect(state.stopReason).toBe("end_turn");
  });

  it("appends error notices with unique ids", () => {
    let state = createDshSessionState("s");
    state = appendNotice(state, "boom");
    state = appendNotice(state, "again");
    const [first, second] = state.items;
    expect(first).toMatchObject({ kind: "notice", tone: "error" });
    expect(first?.id).not.toBe(second?.id);
  });
});
