import {
  type ClientConnection,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  client,
  type ListSessionsResponse,
  type NewSessionResponse,
  ndJsonStream,
  PROTOCOL_VERSION,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ResumeSessionResponse,
  type SessionUpdate,
  type SetSessionConfigOptionResponse,
  type Stream,
} from "@agentclientprotocol/sdk";
import {
  type AcpExitInfo,
  type AcpProcess,
  startAcpProcess,
  watchAcpLogs,
} from "./transport";

/** Callbacks the host app (store/UI) provides to a {@link DshAcpClient}. */
export type DshClientHandlers = {
  onUpdate: (update: SessionUpdate, sessionId: string) => void;
  onPermission: (
    req: RequestPermissionRequest,
  ) => Promise<RequestPermissionResponse>;
  onElicitation: (
    req: CreateElicitationRequest,
  ) => Promise<CreateElicitationResponse>;
  onExit: (info: AcpExitInfo) => void;
  onLog: (line: string, kind: "stdout" | "stderr") => void;
};

/**
 * Client for a DSH ACP agent: owns the spawned process (unless a stream factory
 * is injected) and the ACP connection, and exposes the session methods the
 * console UI needs.
 */
export class DshAcpClient {
  status: "idle" | "connecting" | "ready" | "closed" = "idle";

  private readonly command: string;
  private readonly cwd: string | null;
  private readonly handlers: DshClientHandlers;
  private readonly createStream: (() => Promise<Stream>) | undefined;

  private connection: ClientConnection | null = null;
  private process: AcpProcess | null = null;
  private unwatchLogs: (() => void) | null = null;
  private exitInfo: AcpExitInfo | null = null;
  private finalized = false;
  private disposed = false;
  private connecting: Promise<void> | null = null;
  private disposing: Promise<void> | null = null;

  constructor(opts: {
    command: string;
    cwd: string | null;
    handlers: DshClientHandlers;
    createStream?: () => Promise<Stream>;
  }) {
    this.command = opts.command;
    this.cwd = opts.cwd;
    this.handlers = opts.handlers;
    this.createStream = opts.createStream;
  }

  /** Spawns the agent (if needed) and performs the ACP `initialize` handshake. */
  async connect(): Promise<void> {
    if (this.status === "ready") return;
    if (this.status === "closed" || this.disposed) {
      throw new Error("DSH ACP client is closed");
    }
    if (this.connecting) return this.connecting;
    this.status = "connecting";
    this.connecting = this.open();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async open(): Promise<void> {
    try {
      const app = client({ name: "Terax" })
        .onNotification("session/update", ({ params }) => {
          this.handlers.onUpdate(params.update, params.sessionId);
        })
        .onRequest("session/request_permission", ({ params }) =>
          this.handlers.onPermission(params),
        )
        .onRequest("elicitation/create", ({ params }) =>
          this.handlers.onElicitation(params),
        );

      let stream: Stream;
      if (this.createStream) {
        stream = await this.createStream();
      } else {
        const process = await startAcpProcess({
          command: this.command,
          cwd: this.cwd,
        });
        if (this.disposed) {
          await process.kill().catch(() => {});
          throw new Error("DSH ACP client was disposed");
        }
        this.process = process;
        this.unwatchLogs = watchAcpLogs(process, (line, kind) => {
          this.handlers.onLog(line, kind);
        });
        this.watchProcess(process);
        stream = ndJsonStream(process.input, process.output);
      }
      if (this.disposed) {
        throw new Error("DSH ACP client was disposed");
      }

      const connection = app.connect(stream);
      this.connection = connection;
      void connection.closed.then(() => this.handleClosed());

      await connection.agent.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          terminal: false,
          fs: { readTextFile: false, writeTextFile: false },
          plan: {},
        },
        clientInfo: { name: "Terax", version: "0.9.0" },
      });
      this.status = "ready";
    } catch (error) {
      this.status = "closed";
      this.connection?.close(error);
      const process = this.process;
      this.process = null;
      await process?.kill().catch(() => {});
      throw error;
    }
  }

  private watchProcess(process: AcpProcess): void {
    void process.exited.then((info) => {
      this.exitInfo = info;
      this.connection?.close();
      this.finalize(info);
    });
  }

  private handleClosed(): void {
    this.finalize(this.exitInfo ?? { code: null });
  }

  private finalize(info: AcpExitInfo): void {
    if (this.finalized) return;
    this.finalized = true;
    this.status = "closed";
    this.unwatchLogs?.();
    this.unwatchLogs = null;
    try {
      this.handlers.onExit(info);
    } catch (error) {
      console.error("[dsh] onExit handler failed", error);
    }
  }

  private requireConnection(): ClientConnection {
    if (this.connection === null || this.status !== "ready") {
      throw new Error("DSH ACP client is not connected");
    }
    return this.connection;
  }

  /** Creates a new ACP session rooted at `cwd`. */
  newSession(cwd: string): Promise<NewSessionResponse> {
    return this.requireConnection().agent.request("session/new", {
      cwd,
      mcpServers: [],
    });
  }

  /** Sends one text prompt and resolves with the final turn response. */
  prompt(sessionId: string, text: string): Promise<PromptResponse> {
    return this.requireConnection().agent.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  /** Cancels the in-flight turn of a session (notification, no response). */
  async cancel(sessionId: string): Promise<void> {
    await this.requireConnection().agent.notify("session/cancel", {
      sessionId,
    });
  }

  /** Updates one session configuration option. */
  setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<SetSessionConfigOptionResponse> {
    const params =
      typeof value === "boolean"
        ? { sessionId, configId, type: "boolean" as const, value }
        : { sessionId, configId, value };
    return this.requireConnection().agent.request(
      "session/set_config_option",
      params,
    );
  }

  /** Lists sessions known to the agent, optionally filtered by `cwd`. */
  listSessions(cwd?: string): Promise<ListSessionsResponse> {
    return this.requireConnection().agent.request("session/list", {
      cwd: cwd ?? null,
    });
  }

  /** Resumes an existing session without replaying its history. */
  resumeSession(
    sessionId: string,
    cwd: string,
  ): Promise<ResumeSessionResponse> {
    return this.requireConnection().agent.request("session/resume", {
      sessionId,
      cwd,
    });
  }

  /** Closes an ACP session and frees its agent-side resources. */
  async closeSession(sessionId: string): Promise<void> {
    await this.requireConnection().agent.request("session/close", {
      sessionId,
    });
  }

  /** Closes the connection and kills the agent process. Idempotent. */
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposing = this.close();
    return this.disposing;
  }

  private async close(): Promise<void> {
    this.disposed = true;
    const connection = this.connection;
    const process = this.process;
    this.connection = null;
    this.process = null;
    this.unwatchLogs?.();
    this.unwatchLogs = null;
    connection?.close();
    if (process) {
      await process.kill().catch((error: unknown) => {
        this.handlers.onLog(String(error), "stderr");
      });
    }
    if (this.status === "idle") {
      this.status = "closed";
      return;
    }
    this.finalize(this.exitInfo ?? { code: null });
  }
}
