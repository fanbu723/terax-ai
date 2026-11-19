import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  const channels: FakeChannel[] = [];
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  const state = { failSpawn: false };

  class FakeChannel {
    onmessage: ((value: unknown) => void) | null = null;
    id = 0;

    constructor() {
      channels.push(this);
    }
  }

  const invoke = async (
    command: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    calls.push({ command, args });
    if (command === "dsh_acp_spawn") {
      if (state.failSpawn) throw new Error("spawn failed");
      return 7;
    }
    return undefined;
  };

  return { channels, calls, state, invoke, FakeChannel };
});

vi.mock("@tauri-apps/api/core", () => ({
  Channel: mock.FakeChannel,
  invoke: mock.invoke,
}));

vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));

import {
  ACP_LOG_MAX_BYTES,
  ACP_LOG_MAX_LINES,
  type AcpExitInfo,
  type AcpStreamEvent,
  isJsonLine,
  pushLog,
  splitLines,
  startAcpProcess,
  watchAcpLogs,
} from "./transport";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function emitEvent(event: AcpStreamEvent): void {
  mock.channels[0]?.onmessage?.(event);
}

function emitExit(info: AcpExitInfo): void {
  mock.channels[1]?.onmessage?.(info);
}

function writeCalls(): string[] {
  return mock.calls
    .filter((call) => call.command === "dsh_acp_write")
    .map((call) => String(call.args.line));
}

beforeEach(() => {
  mock.channels.length = 0;
  mock.calls.length = 0;
  mock.state.failSpawn = false;
});

describe("splitLines", () => {
  it("keeps an unterminated chunk as the rest", () => {
    expect(splitLines("", '{"a":1}')).toEqual({
      lines: [],
      rest: '{"a":1}',
    });
  });

  it("splits complete lines and carries the trailing partial line", () => {
    expect(splitLines("", "one\ntwo\nthree")).toEqual({
      lines: ["one", "two"],
      rest: "three",
    });
  });

  it("joins the buffered remainder with the next chunk", () => {
    const first = splitLines("", "abc\ndef");
    const second = splitLines(first.rest, "gh\nij");
    expect(second).toEqual({ lines: ["defgh"], rest: "ij" });
  });

  it("strips CRLF line endings", () => {
    expect(splitLines("", "one\r\ntwo\r\n")).toEqual({
      lines: ["one", "two"],
      rest: "",
    });
  });
});

describe("isJsonLine", () => {
  it("accepts JSON object and array payloads", () => {
    expect(isJsonLine('{"jsonrpc":"2.0","id":1}')).toBe(true);
    expect(isJsonLine('  {"jsonrpc":"2.0"}  ')).toBe(true);
    expect(isJsonLine("[1,2]")).toBe(true);
  });

  it("rejects non-JSON lines and bare scalars", () => {
    expect(isJsonLine("not json")).toBe(false);
    expect(isJsonLine("")).toBe(false);
    expect(isJsonLine("42")).toBe(false);
    expect(isJsonLine("null")).toBe(false);
  });
});

describe("pushLog", () => {
  it("keeps at most the configured number of lines, dropping the oldest", () => {
    const logs: string[] = [];
    for (let index = 0; index < ACP_LOG_MAX_LINES + 50; index += 1) {
      pushLog(logs, `line-${index}`);
    }
    expect(logs).toHaveLength(ACP_LOG_MAX_LINES);
    expect(logs[0]).toBe(`line-${50}`);
    expect(logs[logs.length - 1]).toBe(`line-${ACP_LOG_MAX_LINES + 49}`);
  });

  it("keeps the total byte size within the cap", () => {
    const logs: string[] = [];
    const line = "x".repeat(1000);
    for (let index = 0; index < 100; index += 1) {
      pushLog(logs, line);
    }
    const bytes = logs.reduce(
      (total, entry) => total + encoder.encode(entry).byteLength + 1,
      0,
    );
    expect(bytes).toBeLessThanOrEqual(ACP_LOG_MAX_BYTES);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.length).toBeLessThan(100);
  });
});

describe("startAcpProcess", () => {
  it("spawns through dsh_acp_spawn with the current workspace", async () => {
    const process = await startAcpProcess({
      command: "dsh",
      cwd: "/tmp/project",
    });

    expect(process.id).toBe(7);
    expect(mock.calls[0]).toMatchObject({
      command: "dsh_acp_spawn",
      args: {
        command: "dsh",
        cwd: "/tmp/project",
        workspace: { kind: "local" },
        onEvent: mock.channels[0],
        onExit: mock.channels[1],
      },
    });
  });

  it("forwards only JSON stdout lines to output", async () => {
    const process = await startAcpProcess({ command: "dsh", cwd: null });
    const reader = process.output.getReader();

    emitEvent({ stream: "stdout", line: "just a debug line" });
    expect(process.logs).toEqual(["just a debug line"]);

    emitEvent({
      stream: "stdout",
      line: '{"jsonrpc":"2.0","method":"session/update"}',
    });
    const chunk = await reader.read();
    expect(decoder.decode(chunk.value)).toBe(
      '{"jsonrpc":"2.0","method":"session/update"}\n',
    );
  });

  it("records stderr in the log ring buffer", async () => {
    const process = await startAcpProcess({ command: "dsh", cwd: null });
    emitEvent({ stream: "stderr", line: "boom" });
    expect(process.logs).toEqual(["boom"]);
  });

  it("splits stdin bytes into lines and flushes the remainder on close", async () => {
    const process = await startAcpProcess({ command: "dsh", cwd: null });
    const writer = process.input.getWriter();

    await writer.write(encoder.encode('{"a":1}\n{"b"'));
    expect(writeCalls()).toEqual(['{"a":1}']);

    await writer.write(encoder.encode(':2}\n{"tail":true}'));
    expect(writeCalls()).toEqual(['{"a":1}', '{"b":2}']);

    await writer.close();
    expect(writeCalls()).toEqual(['{"a":1}', '{"b":2}', '{"tail":true}']);
    expect(mock.calls[mock.calls.length - 1]?.args.id).toBe(7);
  });

  it("resolves exited, closes output, and makes kill idempotent", async () => {
    const process = await startAcpProcess({ command: "dsh", cwd: null });
    const reader = process.output.getReader();

    emitExit({ code: 3 });
    await expect(process.exited).resolves.toEqual({ code: 3 });
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });

    await process.kill();
    emitExit({ code: 3 });
    await process.kill();
    const killCalls = mock.calls.filter(
      (call) => call.command === "dsh_acp_kill",
    );
    expect(killCalls).toHaveLength(0);
  });

  it("calls dsh_acp_kill while the process is running", async () => {
    const process = await startAcpProcess({ command: "dsh", cwd: null });
    await process.kill();
    expect(mock.calls[mock.calls.length - 1]).toMatchObject({
      command: "dsh_acp_kill",
      args: { id: 7 },
    });
  });

  it("rejects when the spawn command fails", async () => {
    mock.state.failSpawn = true;
    await expect(
      startAcpProcess({ command: "dsh", cwd: null }),
    ).rejects.toThrow("spawn failed");
  });

  it("replays early log lines and streams new ones to watchers", async () => {
    const process = await startAcpProcess({ command: "dsh", cwd: null });
    emitEvent({ stream: "stdout", line: "non-json stdout" });
    emitEvent({ stream: "stderr", line: "early stderr" });

    const seen: Array<[string, "stdout" | "stderr"]> = [];
    const unwatch = watchAcpLogs(process, (line, kind) => {
      seen.push([line, kind]);
    });
    expect(seen).toEqual([
      ["non-json stdout", "stdout"],
      ["early stderr", "stderr"],
    ]);

    emitEvent({ stream: "stderr", line: "live stderr" });
    expect(seen[seen.length - 1]).toEqual(["live stderr", "stderr"]);

    unwatch();
    emitEvent({ stream: "stderr", line: "after unsubscribe" });
    expect(seen[seen.length - 1]).toEqual(["live stderr", "stderr"]);
    expect(process.logs).toContain("after unsubscribe");
  });

  it("stops forwarding to output after exit", async () => {
    const process = await startAcpProcess({ command: "dsh", cwd: null });
    const reader = process.output.getReader();
    emitExit({ code: 0 });
    await process.exited;

    emitEvent({ stream: "stdout", line: '{"jsonrpc":"2.0","id":1}' });
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(process.logs).toHaveLength(0);
  });
});
