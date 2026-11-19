import { currentWorkspaceEnv } from "@/modules/workspace";
import { Channel, invoke } from "@tauri-apps/api/core";

/** One line emitted by the spawned ACP agent process. */
export type AcpStreamEvent = { stream: "stdout" | "stderr"; line: string };

/** How the spawned ACP agent process terminated. */
export type AcpExitInfo = { code: number | null };

/** A live ACP agent process plus the stdio handles the ACP client needs. */
export type AcpProcess = {
  id: number;
  output: ReadableStream<Uint8Array>;
  input: WritableStream<Uint8Array>;
  exited: Promise<AcpExitInfo>;
  logs: string[];
  kill: () => Promise<void>;
};

/** Maximum number of diagnostic lines kept in {@link AcpProcess.logs}. */
export const ACP_LOG_MAX_LINES = 200;

/** Maximum number of bytes kept in {@link AcpProcess.logs} (UTF-8). */
export const ACP_LOG_MAX_BYTES = 64 * 1024;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function utf8Bytes(text: string): number {
  return textEncoder.encode(text).byteLength;
}

function trimLogs<Entry>(
  entries: Entry[],
  lineOf: (entry: Entry) => string,
): void {
  let bytes = 0;
  for (const entry of entries) bytes += utf8Bytes(lineOf(entry)) + 1;
  while (
    entries.length > 0 &&
    (entries.length > ACP_LOG_MAX_LINES || bytes > ACP_LOG_MAX_BYTES)
  ) {
    const [removed] = entries.splice(0, 1);
    if (removed === undefined) break;
    bytes -= utf8Bytes(lineOf(removed)) + 1;
  }
}

/**
 * Appends one diagnostic line to a ring buffer bounded to
 * {@link ACP_LOG_MAX_LINES} lines / {@link ACP_LOG_MAX_BYTES} UTF-8 bytes,
 * dropping the oldest lines first.
 */
export function pushLog(logs: string[], line: string): void {
  logs.push(line);
  trimLogs(logs, (entry) => entry);
}

/**
 * Splits a text stream into complete lines, carrying the trailing partial line
 * in `rest` for the next chunk. Trailing `\r` (CRLF) and `\n` are stripped.
 */
export function splitLines(
  buffer: string,
  chunk: string,
): { lines: string[]; rest: string } {
  const parts = (buffer + chunk).split("\n");
  const rest = parts.pop() ?? "";
  const lines = parts.map((line) =>
    line.endsWith("\r") ? line.slice(0, -1) : line,
  );
  return { lines, rest };
}

/**
 * Whether a stdout line is a JSON-RPC payload the ACP stream can consume.
 *
 * A line passes when `JSON.parse` succeeds *and* yields an object or array:
 * bare scalars (`42`, `null`, ...) parse but are not JSON-RPC messages, and
 * forwarding them would make the ACP stream answer with a parse error.
 */
export function isJsonLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

type LogEntry = { line: string; kind: "stdout" | "stderr" };

type LogSink = {
  entries: LogEntry[];
  listeners: Set<(line: string, kind: "stdout" | "stderr") => void>;
};

const logSinks = new WeakMap<AcpProcess, LogSink>();

/**
 * Subscribes to the diagnostic lines of a spawned process, replaying lines that
 * arrived before the subscription (all bounded by the same ring buffer as
 * {@link AcpProcess.logs}). Returns an unsubscribe function.
 */
export function watchAcpLogs(
  process: AcpProcess,
  listener: (line: string, kind: "stdout" | "stderr") => void,
): () => void {
  const sink = logSinks.get(process);
  if (!sink) return () => {};
  for (const entry of sink.entries) listener(entry.line, entry.kind);
  sink.listeners.add(listener);
  return () => {
    sink.listeners.delete(listener);
  };
}

/**
 * Spawns `command` through the Tauri `dsh_acp_spawn` command and exposes its
 * stdio as Web Streams for {@link ndJsonStream}.
 */
export async function startAcpProcess(opts: {
  command: string;
  cwd: string | null;
}): Promise<AcpProcess> {
  const logs: string[] = [];
  const sink: LogSink = { entries: [], listeners: new Set() };

  const record = (line: string, kind: "stdout" | "stderr"): void => {
    pushLog(logs, line);
    sink.entries.push({ line, kind });
    trimLogs(sink.entries, (entry) => entry.line);
    for (const listener of sink.listeners) {
      try {
        listener(line, kind);
      } catch (error) {
        // A broken listener must not take the transport down with it.
        console.error("[dsh] log listener failed", error);
      }
    }
  };

  const events = new Channel<AcpStreamEvent>();
  const exitChannel = new Channel<AcpExitInfo>();

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let outputClosed = false;
  const output = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
    cancel() {
      outputClosed = true;
      controller = null;
    },
  });

  const closeOutput = (): void => {
    if (outputClosed) return;
    outputClosed = true;
    const current = controller;
    controller = null;
    try {
      current?.close();
    } catch {
      // Already closed or cancelled by the consumer.
    }
  };

  events.onmessage = ({ stream, line }) => {
    if (stream === "stdout" && isJsonLine(line)) {
      if (outputClosed || controller === null) return;
      controller.enqueue(textEncoder.encode(`${line.trim()}\n`));
      return;
    }
    record(line, stream);
  };

  let resolveExit!: (info: AcpExitInfo) => void;
  const exited = new Promise<AcpExitInfo>((resolve) => {
    resolveExit = resolve;
  });
  let hasExited = false;
  exitChannel.onmessage = (info) => {
    if (hasExited) return;
    hasExited = true;
    resolveExit(info);
    closeOutput();
  };

  let sessionId: number | null = null;
  let pendingText = "";

  const writeLine = async (line: string): Promise<void> => {
    if (sessionId === null || line.length === 0) return;
    await invoke("dsh_acp_write", { id: sessionId, line });
  };

  const input = new WritableStream<Uint8Array>({
    async write(chunk) {
      const { lines, rest } = splitLines(
        pendingText,
        textDecoder.decode(chunk, { stream: true }),
      );
      pendingText = rest;
      for (const line of lines) await writeLine(line);
    },
    async close() {
      const tail = splitLines(pendingText, textDecoder.decode());
      pendingText = "";
      for (const line of tail.lines) await writeLine(line);
      await writeLine(tail.rest);
    },
  });

  const id = await invoke<number>("dsh_acp_spawn", {
    command: opts.command,
    cwd: opts.cwd,
    workspace: currentWorkspaceEnv(),
    onEvent: events,
    onExit: exitChannel,
  });
  sessionId = id;

  const process: AcpProcess = {
    id,
    output,
    input,
    exited,
    logs,
    kill: async () => {
      if (hasExited || sessionId === null) return;
      await invoke("dsh_acp_kill", { id: sessionId });
    },
  };
  logSinks.set(process, sink);
  return process;
}
