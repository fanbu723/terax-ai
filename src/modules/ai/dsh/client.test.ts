import type {
  AgentApp,
  AgentConnection,
  AnyMessage,
  Stream,
} from "@agentclientprotocol/sdk";
import {
  agent,
  PROTOCOL_VERSION,
  RequestError,
} from "@agentclientprotocol/sdk";
import { describe, expect, it, type Mock, onTestFinished, vi } from "vitest";

// The client module imports the Tauri transport; tests inject `createStream`
// and never touch the real IPC bridge.
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: async () => 0,
}));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));

import { DshAcpClient, type DshClientHandlers } from "./client";

type SpyFn = Mock<(value: unknown) => void>;

type Spy = {
  initialize: SpyFn;
  newSession: SpyFn;
  prompt: SpyFn;
  cancel: SpyFn;
  setConfigOption: SpyFn;
  listSessions: SpyFn;
  resume: SpyFn;
  closeSession: SpyFn;
  permission: SpyFn;
  elicitation: SpyFn;
};

type Harness = {
  dsh: DshAcpClient;
  handlers: DshClientHandlers;
  pair: ReturnType<typeof memoryStreams>;
  spy: Spy;
  agentConnection: AgentConnection;
};

/** Two connected JSON-RPC message streams, one per ACP side. */
function memoryStreams(): { client: Stream; agent: Stream } {
  const toAgent = new TransformStream<AnyMessage, AnyMessage>();
  const toClient = new TransformStream<AnyMessage, AnyMessage>();
  return {
    client: { writable: toAgent.writable, readable: toClient.readable },
    agent: { writable: toClient.writable, readable: toAgent.readable },
  };
}

function createHandlers(): DshClientHandlers {
  return {
    onUpdate: vi.fn(),
    onPermission: vi.fn(async () => ({
      outcome: { outcome: "cancelled" as const },
    })),
    onElicitation: vi.fn(async () => ({ action: "cancel" as const })),
    onExit: vi.fn(),
    onLog: vi.fn(),
  };
}

async function createHarness(
  configure: (app: AgentApp, spy: Spy) => void,
): Promise<Harness> {
  const pair = memoryStreams();
  const spy: Spy = {
    initialize: vi.fn<(value: unknown) => void>(),
    newSession: vi.fn<(value: unknown) => void>(),
    prompt: vi.fn<(value: unknown) => void>(),
    cancel: vi.fn<(value: unknown) => void>(),
    setConfigOption: vi.fn<(value: unknown) => void>(),
    listSessions: vi.fn<(value: unknown) => void>(),
    resume: vi.fn<(value: unknown) => void>(),
    closeSession: vi.fn<(value: unknown) => void>(),
    permission: vi.fn<(value: unknown) => void>(),
    elicitation: vi.fn<(value: unknown) => void>(),
  };
  const app = agent({ name: "fake-agent" });
  app.onRequest("initialize", ({ params }) => {
    spy.initialize(params);
    return { protocolVersion: PROTOCOL_VERSION };
  });
  configure(app, spy);
  const agentConnection = app.connect(pair.agent);

  const handlers = createHandlers();
  const dsh = new DshAcpClient({
    command: "fake-agent",
    cwd: null,
    handlers,
    createStream: async () => pair.client,
  });

  onTestFinished(async () => {
    await dsh.dispose().catch(() => {});
    agentConnection.close();
  });

  await dsh.connect();
  return { dsh, handlers, pair, spy, agentConnection };
}

describe("DshAcpClient connect", () => {
  it("initializes with the Terax client capabilities and becomes ready", async () => {
    const { dsh, spy } = await createHarness(() => {});
    expect(dsh.status).toBe("ready");

    expect(spy.initialize).toHaveBeenCalledTimes(1);
    expect(spy.initialize.mock.calls[0][0]).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        terminal: false,
        fs: { readTextFile: false, writeTextFile: false },
        plan: {},
      },
      clientInfo: { name: "Terax", version: "0.9.0" },
    });
  });

  it("is idempotent once connected", async () => {
    const { dsh, spy } = await createHarness(() => {});
    await dsh.connect();
    expect(spy.initialize).toHaveBeenCalledTimes(1);
  });

  it("rejects session calls before connect", async () => {
    const dsh = new DshAcpClient({
      command: "fake-agent",
      cwd: null,
      handlers: createHandlers(),
    });
    expect(() => dsh.newSession("/tmp/work")).toThrow("not connected");
    await dsh.dispose();
  });
});

describe("DshAcpClient sessions", () => {
  it("creates a session with an empty MCP server list", async () => {
    const { dsh, spy } = await createHarness((app, spy) => {
      app.onRequest("session/new", ({ params }) => {
        spy.newSession(params);
        return { sessionId: "session-1" };
      });
    });

    const response = await dsh.newSession("/tmp/work");
    expect(response.sessionId).toBe("session-1");
    expect(spy.newSession.mock.calls[0][0]).toMatchObject({
      cwd: "/tmp/work",
      mcpServers: [],
    });
  });

  it("prompts with one text block and surfaces session updates", async () => {
    const { dsh, handlers, spy } = await createHarness((app, spy) => {
      app.onRequest("session/prompt", async ({ params, client: agentCtx }) => {
        spy.prompt(params);
        await agentCtx.notify("session/update", {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello from the agent" },
          },
        });
        return { stopReason: "end_turn" };
      });
    });

    const response = await dsh.prompt("session-1", "hi there");
    expect(response.stopReason).toBe("end_turn");
    expect(spy.prompt.mock.calls[0][0]).toMatchObject({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "hi there" }],
    });

    await vi.waitFor(() => {
      expect(handlers.onUpdate).toHaveBeenCalledTimes(1);
    });
    const [update, sessionId] = vi.mocked(handlers.onUpdate).mock.calls[0];
    expect(update).toMatchObject({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hello from the agent" },
    });
    expect(sessionId).toBe("session-1");
  });

  it("answers session/request_permission through the permission handler", async () => {
    const { dsh, handlers, spy } = await createHarness((app, spy) => {
      app.onRequest("session/prompt", async ({ params, client: agentCtx }) => {
        const permission = await agentCtx.request(
          "session/request_permission",
          {
            sessionId: params.sessionId,
            toolCall: { toolCallId: "call-1", title: "Run the tests" },
            options: [
              { optionId: "allow", name: "Allow", kind: "allow_once" },
              { optionId: "reject", name: "Reject", kind: "reject_once" },
            ],
          },
        );
        spy.permission(permission);
        return { stopReason: "end_turn" };
      });
    });
    vi.mocked(handlers.onPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "allow" },
    });

    await dsh.prompt("session-1", "run");

    expect(handlers.onPermission).toHaveBeenCalledTimes(1);
    const request = vi.mocked(handlers.onPermission).mock.calls[0][0];
    expect(request.sessionId).toBe("session-1");
    expect(request.toolCall.toolCallId).toBe("call-1");
    expect(spy.permission.mock.calls[0][0]).toMatchObject({
      outcome: { outcome: "selected", optionId: "allow" },
    });
  });

  it("answers elicitation/create through the elicitation handler", async () => {
    const { dsh, handlers, spy } = await createHarness((app, spy) => {
      app.onRequest("session/prompt", async ({ params, client: agentCtx }) => {
        const elicitation = await agentCtx.request("elicitation/create", {
          mode: "form",
          sessionId: params.sessionId,
          message: "What is your name?",
          requestedSchema: {
            type: "object",
            properties: { name: { type: "string", title: "Name" } },
          },
        });
        spy.elicitation(elicitation);
        return { stopReason: "end_turn" };
      });
    });
    vi.mocked(handlers.onElicitation).mockResolvedValue({
      action: "accept",
      content: { name: "Ada" },
    });

    await dsh.prompt("session-1", "ask me");

    expect(handlers.onElicitation).toHaveBeenCalledTimes(1);
    const request = vi.mocked(handlers.onElicitation).mock.calls[0][0];
    expect(request.message).toBe("What is your name?");
    expect(spy.elicitation.mock.calls[0][0]).toMatchObject({
      action: "accept",
      content: { name: "Ada" },
    });
  });

  it("sends session/cancel as a notification", async () => {
    const { dsh, spy } = await createHarness((app, spy) => {
      app.onNotification("session/cancel", ({ params }) => {
        spy.cancel(params);
      });
    });

    await dsh.cancel("session-1");

    await vi.waitFor(() => {
      expect(spy.cancel).toHaveBeenCalledTimes(1);
    });
    expect(spy.cancel.mock.calls[0][0]).toMatchObject({
      sessionId: "session-1",
    });
  });

  it("sends boolean and string config option values", async () => {
    const { dsh, spy } = await createHarness((app, spy) => {
      app.onRequest("session/set_config_option", ({ params }) => {
        spy.setConfigOption(params);
        return { configOptions: [] };
      });
    });

    await expect(
      dsh.setConfigOption("session-1", "model", "fast"),
    ).resolves.toEqual({ configOptions: [] });
    await dsh.setConfigOption("session-1", "autoApprove", true);

    expect(spy.setConfigOption.mock.calls[0][0]).toMatchObject({
      sessionId: "session-1",
      configId: "model",
      value: "fast",
    });
    expect(spy.setConfigOption.mock.calls[1][0]).toMatchObject({
      sessionId: "session-1",
      configId: "autoApprove",
      type: "boolean",
      value: true,
    });
  });

  it("lists, resumes, and closes sessions", async () => {
    const { dsh, spy } = await createHarness((app, spy) => {
      app.onRequest("session/list", ({ params }) => {
        spy.listSessions(params);
        return { sessions: [{ sessionId: "session-1", cwd: "/tmp/work" }] };
      });
      app.onRequest("session/resume", ({ params }) => {
        spy.resume(params);
        return { configOptions: [] };
      });
      app.onRequest("session/close", ({ params }) => {
        spy.closeSession(params);
        return {};
      });
    });

    const listed = await dsh.listSessions("/tmp/work");
    expect(listed.sessions[0]?.sessionId).toBe("session-1");
    expect(spy.listSessions.mock.calls[0][0]).toMatchObject({
      cwd: "/tmp/work",
    });

    await dsh.listSessions();
    expect(spy.listSessions.mock.calls[1][0]).toMatchObject({ cwd: null });

    await expect(dsh.resumeSession("session-1", "/tmp/work")).resolves.toEqual({
      configOptions: [],
    });
    expect(spy.resume.mock.calls[0][0]).toMatchObject({
      sessionId: "session-1",
      cwd: "/tmp/work",
    });

    await dsh.closeSession("session-1");
    expect(spy.closeSession.mock.calls[0][0]).toMatchObject({
      sessionId: "session-1",
    });
  });

  it("surfaces JSON-RPC error responses from the agent", async () => {
    const { dsh } = await createHarness((app) => {
      app.onRequest("session/prompt", () => {
        throw new RequestError(-32000, "agent unavailable");
      });
    });

    await expect(dsh.prompt("session-1", "hi")).rejects.toThrow(
      "agent unavailable",
    );
  });
});

describe("DshAcpClient lifecycle", () => {
  it("closes and reports onExit when the agent stream ends", async () => {
    const { dsh, handlers, pair } = await createHarness(() => {});

    await pair.agent.writable.close();

    await vi.waitFor(() => {
      expect(dsh.status).toBe("closed");
    });
    expect(handlers.onExit).toHaveBeenCalledTimes(1);
    expect(handlers.onExit).toHaveBeenCalledWith({ code: null });
  });

  it("dispose closes the client once and is idempotent", async () => {
    const { dsh, handlers } = await createHarness(() => {});

    await dsh.dispose();
    await dsh.dispose();

    expect(dsh.status).toBe("closed");
    expect(handlers.onExit).toHaveBeenCalledTimes(1);
    expect(handlers.onExit).toHaveBeenCalledWith({ code: null });
  });

  it("marks itself closed when the initialize handshake fails", async () => {
    const pair = memoryStreams();
    const app = agent({ name: "fake-agent" });
    app.onRequest("initialize", () => {
      throw new RequestError(-32000, "handshake rejected");
    });
    const agentConnection = app.connect(pair.agent);
    const dsh = new DshAcpClient({
      command: "fake-agent",
      cwd: null,
      handlers: createHandlers(),
      createStream: async () => pair.client,
    });
    onTestFinished(async () => {
      await dsh.dispose().catch(() => {});
      agentConnection.close();
    });

    await expect(dsh.connect()).rejects.toThrow("handshake rejected");
    expect(dsh.status).toBe("closed");
  });

  it("does not become ready when disposed while connecting", async () => {
    const pair = memoryStreams();
    const app = agent({ name: "fake-agent" });
    app.onRequest("initialize", () => ({ protocolVersion: PROTOCOL_VERSION }));
    const agentConnection = app.connect(pair.agent);
    const handlers = createHandlers();
    let release!: (stream: Stream) => void;
    const pendingStream = new Promise<Stream>((resolve) => {
      release = resolve;
    });
    const dsh = new DshAcpClient({
      command: "fake-agent",
      cwd: null,
      handlers,
      createStream: () => pendingStream,
    });
    onTestFinished(async () => {
      await dsh.dispose().catch(() => {});
      agentConnection.close();
    });

    const connecting = dsh.connect().catch((error: unknown) => error);
    await dsh.dispose();
    release(pair.client);
    const outcome = await connecting;

    expect(outcome).toBeInstanceOf(Error);
    expect(dsh.status).toBe("closed");
    expect(handlers.onExit).toHaveBeenCalledTimes(1);
  });
});
