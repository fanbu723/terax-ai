import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionInfo,
  SessionUpdate,
  SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk";
import { create } from "zustand";
import { useChatStore } from "../store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { normalizeDshAcpCommand } from "@/modules/settings/store";
import { DshAcpClient, type DshClientHandlers } from "./client";
import {
  buildPersistedState,
  flushDshPersist,
  loadDshState,
  restoreSessions,
  scheduleDshPersist,
} from "./persist";
import type { AcpExitInfo } from "./transport";
import { useDshTargetStore } from "./target";
import {
  appendNotice,
  appendUserTurn,
  applyDshUpdate,
  createDshSessionState,
  setPromptRunning,
  type DshSessionState,
} from "./updates";

export type DshConnectionStatus = "idle" | "connecting" | "ready" | "error";

export type DshPendingPermission = {
  key: string;
  sessionId: string;
  request: RequestPermissionRequest;
};

export type DshPendingElicitation = {
  key: string;
  sessionId: string | null;
  request: CreateElicitationRequest;
};

type DshStoreState = {
  hydrated: boolean;
  connStatus: DshConnectionStatus;
  connError: string | null;
  connLogs: string[];
  connStartedAt: number | null;
  sessions: Record<string, DshSessionState>;
  currentByChat: Record<string, string>;
  permissions: DshPendingPermission[];
  elicitations: DshPendingElicitation[];

  hydrate: () => Promise<void>;
  ensureConnection: () => Promise<boolean>;
  send: (chatSessionId: string, text: string) => Promise<void>;
  cancel: (chatSessionId: string) => Promise<void>;
  newSession: (chatSessionId: string) => Promise<void>;
  resumeSession: (chatSessionId: string, acpSessionId: string) => Promise<void>;
  listSessions: () => Promise<SessionInfo[]>;
  closeSession: (chatSessionId: string) => Promise<void>;
  setConfig: (
    chatSessionId: string,
    configId: string,
    value: string | boolean,
  ) => Promise<void>;
  respondPermission: (key: string, optionId: string | null) => void;
  respondElicitation: (
    key: string,
    response: CreateElicitationResponse,
  ) => void;
  retry: () => Promise<boolean>;
  disconnect: () => Promise<void>;
};

const MAX_LOGS = 200;

type SetDsh = (
  update:
    | Partial<DshStoreState>
    | ((state: DshStoreState) => Partial<DshStoreState>),
) => void;
type GetDsh = () => DshStoreState;

let client: DshAcpClient | null = null;
let connecting: Promise<boolean> | null = null;
/** Set while dispose() tears the bridge down, so the exit is not an error. */
let closingIntentionally = false;
let connectCancelled = false;
let feedbackSeq = 0;
const attachedSessions = new Set<string>();
const sendingChats = new Set<string>();
const permissionResolvers = new Map<
  string,
  (response: RequestPermissionResponse) => void
>();
let logBuffer: string[] = [];
let logTimer: ReturnType<typeof setTimeout> | null = null;
const elicitationResolvers = new Map<
  string,
  (response: CreateElicitationResponse) => void
>();

const config = () => usePreferencesStore.getState();
const live = () => useChatStore.getState().live;

function sessionCwd(): string | null {
  return live().getWorkspaceRoot() ?? live().getCwd();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function elicitationSessionId(request: CreateElicitationRequest): string | null {
  if ("sessionId" in request && typeof request.sessionId === "string") {
    return request.sessionId;
  }
  return null;
}

function queueLog(set: SetDsh, line: string): void {
  logBuffer.push(line);
  if (logTimer !== null) return;
  logTimer = setTimeout(() => {
    logTimer = null;
    const lines = logBuffer;
    logBuffer = [];
    if (lines.length === 0) return;
    set((state) => ({
      connLogs: [...state.connLogs, ...lines].slice(-MAX_LOGS),
    }));
  }, 200);
}

function focusDshChat(sessionId: string | null): void {
  if (!sessionId) return;
  const chat = Object.entries(useDshStore.getState().currentByChat).find(
    ([, acpSessionId]) => acpSessionId === sessionId,
  );
  if (chat) useDshTargetStore.getState().setTarget(chat[0], "dsh");
  useChatStore.getState().openMini();
}

function clearLogQueue(): void {
  logBuffer = [];
  if (logTimer !== null) {
    clearTimeout(logTimer);
    logTimer = null;
  }
}

function nextFeedbackKey(prefix: string): string {
  feedbackSeq += 1;
  return `${prefix}${feedbackSeq}`;
}

function snapshot() {
  const state = useDshStore.getState();
  return buildPersistedState(state.sessions, state.currentByChat);
}

function persistSoon(): void {
  scheduleDshPersist(snapshot);
}

function cloneSession(session: DshSessionState): DshSessionState {
  return {
    ...session,
    items: session.items.map((item) => ({ ...item })),
  };
}

function cancelPendingFor(sessionId: string | null, set: SetDsh): void {
  const state = useDshStore.getState();
  for (const permission of state.permissions) {
    if (sessionId !== null && permission.sessionId !== sessionId) continue;
    permissionResolvers.get(permission.key)?.({ outcome: { outcome: "cancelled" } });
    permissionResolvers.delete(permission.key);
  }
  for (const elicitation of state.elicitations) {
    if (sessionId !== null && elicitation.sessionId !== sessionId) continue;
    elicitationResolvers.get(elicitation.key)?.({ action: "cancel" });
    elicitationResolvers.delete(elicitation.key);
  }
  set((s) => ({
    permissions:
      sessionId === null
        ? []
        : s.permissions.filter((p) => p.sessionId !== sessionId),
    elicitations:
      sessionId === null
        ? []
        : s.elicitations.filter((e) => e.sessionId !== sessionId),
  }));
}

function connectionHandlers(set: SetDsh): DshClientHandlers {
  const applySession = (
    sessionId: string,
    change: (draft: DshSessionState) => DshSessionState,
  ) => {
    set((state) => {
      const base = state.sessions[sessionId] ?? createDshSessionState(sessionId);
      const next = change(cloneSession(base));
      return { sessions: { ...state.sessions, [sessionId]: next } };
    });
    persistSoon();
  };

  return {
    onUpdate: (update: SessionUpdate, sessionId: string) => {
      applySession(sessionId, (draft) => applyDshUpdate(draft, update));
    },
    onPermission: (request: RequestPermissionRequest) =>
      new Promise<RequestPermissionResponse>((resolve) => {
        const key = nextFeedbackKey("perm");
        permissionResolvers.set(key, resolve);
        set((state) => ({
          permissions: [
            ...state.permissions,
            { key, sessionId: request.sessionId, request },
          ],
        }));
        focusDshChat(request.sessionId);
      }),
    onElicitation: (request: CreateElicitationRequest) => {
      if (request.mode !== "form") {
        // URL and custom modes are not rendered by this console.
        return Promise.resolve<CreateElicitationResponse>({ action: "cancel" });
      }
      return new Promise<CreateElicitationResponse>((resolve) => {
        const key = nextFeedbackKey("elic");
        elicitationResolvers.set(key, resolve);
        set((state) => ({
          elicitations: [
            ...state.elicitations,
            {
              key,
              sessionId: elicitationSessionId(request),
              request,
            },
          ],
        }));
        focusDshChat(
          "sessionId" in request && typeof request.sessionId === "string"
            ? request.sessionId
            : null,
        );
      });
    },
    onExit: (info: AcpExitInfo) => {
      client = null;
      attachedSessions.clear();
      cancelPendingFor(null, set);
      if (closingIntentionally) {
        closingIntentionally = false;
        set({ connStatus: "idle", connError: null });
        return;
      }
      set({
        connStatus: "error",
        connError:
          info.code === 0
            ? "DSH exited."
            : `DSH exited with code ${info.code ?? "unknown"}.`,
        permissions: [],
        elicitations: [],
      });
    },
    onLog: (line: string) => {
      queueLog(set, line);
    },
  };
}

export const useDshStore = create<DshStoreState>((set, get) => ({
  hydrated: false,
  connStatus: "idle",
  connError: null,
  connLogs: [],
  connStartedAt: null,
  sessions: {},
  currentByChat: {},
  permissions: [],
  elicitations: [],

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const persisted = await loadDshState();
      set((state) => ({
        hydrated: true,
        sessions: { ...restoreSessions(persisted), ...state.sessions },
        currentByChat: {
          ...(persisted?.currentByChat ?? {}),
          ...state.currentByChat,
        },
      }));
    } catch (error) {
      console.error("[terax] failed to restore the DSH console:", error);
      set({ hydrated: true });
    }
  },

  ensureConnection: async () => {
    if (client && get().connStatus === "ready") return true;
    if (connecting) return connecting;
    const command = normalizeDshAcpCommand(config().dshAcpCommand);
    const cwd = sessionCwd();
    closingIntentionally = false;
    connectCancelled = false;
    set({
      connStatus: "connecting",
      connError: null,
      connLogs: [],
      connStartedAt: Date.now(),
    });
    clearLogQueue();
    connecting = (async () => {
      try {
        const instance = new DshAcpClient({
          command,
          cwd,
          handlers: connectionHandlers(set),
        });
        // Publish it before the handshake so disconnect/cancel can kill an
        // agent that is still booting its profile on first run.
        client = instance;
        await instance.connect();
        attachedSessions.clear();
        set({ connStatus: "ready", connStartedAt: Date.now() });
        return true;
      } catch (error) {
        client = null;
        if (connectCancelled) {
          connectCancelled = false;
          set({ connStatus: "idle", connError: null });
          return false;
        }
        set({ connStatus: "error", connError: errorText(error) });
        return false;
      } finally {
        connecting = null;
      }
    })();
    return connecting;
  },

  send: async (chatSessionId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const activeId = get().currentByChat[chatSessionId];
    if (activeId && get().sessions[activeId]?.busy) return;
    if (sendingChats.has(chatSessionId)) return;
    sendingChats.add(chatSessionId);
    useChatStore.getState().openMini();
    try {
      await get().hydrate();
      if (!(await get().ensureConnection()) || !client) return;
      await sendPrompt(chatSessionId, text);
    } finally {
      sendingChats.delete(chatSessionId);
    }
  },

  cancel: async (chatSessionId) => {
    const sessionId = get().currentByChat[chatSessionId];
    if (!sessionId || !client) return;
    cancelPendingFor(sessionId, set);
    try {
      await client.cancel(sessionId);
    } catch (error) {
      set((state) => {
        const base = state.sessions[sessionId];
        if (!base) return {};
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: appendNotice(cloneSession(base), errorText(error)),
          },
        };
      });
    }
  },

  newSession: async (chatSessionId) => {
    if (!(await get().ensureConnection()) || !client) return;
    const connected = client;
    const previous = get().currentByChat[chatSessionId];
    if (previous && attachedSessions.has(previous)) {
      attachedSessions.delete(previous);
      void connected.closeSession(previous).catch(() => {});
    }
    try {
      const response = await connected.newSession(sessionCwd() ?? ".");
      attachedSessions.add(response.sessionId);
      const state = createDshSessionState(response.sessionId);
      state.configOptions = response.configOptions ?? [];
      set((s) => ({
        sessions: { ...s.sessions, [response.sessionId]: state },
        currentByChat: {
          ...s.currentByChat,
          [chatSessionId]: response.sessionId,
        },
      }));
      persistSoon();
    } catch (error) {
      appendSessionNotice(set, previous, errorText(error));
    }
  },

  resumeSession: async (chatSessionId, acpSessionId) => {
    if (!(await get().ensureConnection()) || !client) return;
    try {
      let configOptions: SessionConfigOption[] | null = null;
      if (!attachedSessions.has(acpSessionId)) {
        const resumed = await client.resumeSession(
          acpSessionId,
          sessionCwd() ?? ".",
        );
        configOptions = resumed.configOptions ?? null;
        attachedSessions.add(acpSessionId);
      }
      set((s) => {
        const base =
          s.sessions[acpSessionId] ?? createDshSessionState(acpSessionId);
        const existing = {
          ...base,
          configOptions: configOptions ?? base.configOptions,
        };
        return {
          sessions: { ...s.sessions, [acpSessionId]: existing },
          currentByChat: { ...s.currentByChat, [chatSessionId]: acpSessionId },
        };
      });
      persistSoon();
    } catch (error) {
      appendSessionNotice(set, get().currentByChat[chatSessionId], errorText(error));
    }
  },

  listSessions: async () => {
    if (!(await get().ensureConnection()) || !client) return [];
    try {
      const response = await client.listSessions(sessionCwd() ?? undefined);
      return response.sessions;
    } catch (error) {
      set({ connError: errorText(error) });
      return [];
    }
  },

  closeSession: async (chatSessionId) => {
    const sessionId = get().currentByChat[chatSessionId];
    if (!sessionId) return;
    if (client && attachedSessions.has(sessionId)) {
      attachedSessions.delete(sessionId);
      try {
        await client.closeSession(sessionId);
      } catch {
        // The session may already be gone; the mapping still has to clear.
      }
    }
    set((state) => {
      const next = { ...state.currentByChat };
      delete next[chatSessionId];
      return { currentByChat: next };
    });
    persistSoon();
  },

  setConfig: async (chatSessionId, configId, value) => {
    const sessionId = get().currentByChat[chatSessionId];
    if (!sessionId || !client) return;
    try {
      const response: SetSessionConfigOptionResponse =
        await client.setConfigOption(sessionId, configId, value);
      set((state) => {
        const base = state.sessions[sessionId];
        if (!base) return {};
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...base,
              configOptions: response.configOptions,
            },
          },
        };
      });
      persistSoon();
    } catch (error) {
      appendSessionNotice(set, sessionId, errorText(error));
    }
  },

  respondPermission: (key, optionId) => {
    const resolve = permissionResolvers.get(key);
    permissionResolvers.delete(key);
    resolve?.(
      optionId
        ? { outcome: { outcome: "selected", optionId } }
        : { outcome: { outcome: "cancelled" } },
    );
    set((state) => ({
      permissions: state.permissions.filter((p) => p.key !== key),
    }));
  },

  respondElicitation: (key, response) => {
    const resolve = elicitationResolvers.get(key);
    elicitationResolvers.delete(key);
    resolve?.(response);
    set((state) => ({
      elicitations: state.elicitations.filter((e) => e.key !== key),
    }));
  },

  retry: async () => {
    await get().disconnect();
    return get().ensureConnection();
  },

  disconnect: async () => {
    if (get().connStatus === "connecting") connectCancelled = true;
    clearLogQueue();
    const current = client;
    client = null;
    attachedSessions.clear();
    cancelPendingFor(null, set);
    set({ connStatus: "idle", connError: null, connLogs: [] });
    if (current) {
      closingIntentionally = true;
      try {
        await current.dispose();
      } catch {
        // Already gone.
      }
    }
  },
}));

async function sendPrompt(chatSessionId: string, text: string): Promise<void> {
  const connected = client;
  if (!connected) return;
  let sessionId: string;
  try {
    sessionId = await ensureSession(chatSessionId, useDshStore.setState, useDshStore.getState);
  } catch (error) {
    const activeId = useDshStore.getState().currentByChat[chatSessionId];
    appendSessionNotice(useDshStore.setState, activeId, errorText(error));
    return;
  }
  useDshStore.setState((state) => {
    const base = state.sessions[sessionId] ?? createDshSessionState(sessionId);
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: appendUserTurn(
          setPromptRunning(cloneSession(base), true),
          text,
        ),
      },
    };
  });
  useDshTargetStore.getState().setBusy(chatSessionId, true);
  persistSoon();
  try {
    const response = await connected.prompt(sessionId, text);
    useDshStore.setState((state) => {
      const base = state.sessions[sessionId];
      if (!base) return {};
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: setPromptRunning(
            cloneSession(base),
            false,
            response.stopReason,
          ),
        },
      };
    });
  } catch (error) {
    useDshStore.setState((state) => {
      const base = state.sessions[sessionId];
      if (!base) return {};
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: appendNotice(
            setPromptRunning(cloneSession(base), false),
            errorText(error),
          ),
        },
      };
    });
  }
  useDshTargetStore.getState().setBusy(chatSessionId, false);
  flushDshPersist(snapshot);
}

function appendSessionNotice(
  set: SetDsh,
  sessionId: string | undefined,
  text: string,
): void {
  if (!sessionId) return;
  set((state) => {
    const base = state.sessions[sessionId];
    if (!base) return {};
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: appendNotice(cloneSession(base), text),
      },
    };
  });
}

async function ensureSession(
  chatSessionId: string,
  set: SetDsh,
  get: GetDsh,
): Promise<string> {
  if (!client) throw new Error("DSH is not connected.");
  const connected = client;
  const current = get().currentByChat[chatSessionId];
  if (current && attachedSessions.has(current)) {
    if (!get().sessions[current]) {
      set((state) => ({
        sessions: {
          ...state.sessions,
          [current]: createDshSessionState(current),
        },
      }));
    }
    return current;
  }
  if (current) {
    try {
      const resumed = await connected.resumeSession(
        current,
        sessionCwd() ?? ".",
      );
      attachedSessions.add(current);
      set((state) => {
        const existing =
          state.sessions[current] ?? createDshSessionState(current);
        if (resumed.configOptions) {
          existing.configOptions = resumed.configOptions;
        }
        return { sessions: { ...state.sessions, [current]: { ...existing } } };
      });
      return current;
    } catch {
      // The persisted session is gone; fall through to a fresh one.
    }
  }
  const response = await connected.newSession(sessionCwd() ?? ".");
  attachedSessions.add(response.sessionId);
  const state = createDshSessionState(response.sessionId);
  state.configOptions = response.configOptions ?? [];
  if (current) {
    appendNotice(
      state,
      "The previous DSH session could not be resumed; started a new one.",
      "info",
    );
  }
  set((store) => ({
    sessions: { ...store.sessions, [response.sessionId]: state },
    currentByChat: {
      ...store.currentByChat,
      [chatSessionId]: response.sessionId,
    },
  }));
  return response.sessionId;
}

export function activeDshSession(
  state: Pick<DshStoreState, "currentByChat" | "sessions">,
  chatSessionId: string | null,
): DshSessionState | null {
  if (!chatSessionId) return null;
  const acpSessionId = state.currentByChat[chatSessionId];
  if (!acpSessionId) return null;
  return state.sessions[acpSessionId] ?? null;
}

