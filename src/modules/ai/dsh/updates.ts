import type {
  AvailableCommand,
  ContentBlock,
  PlanEntry,
  SessionConfigOption,
  SessionUpdate,
  ToolCallContent,
  ToolCallStatus,
} from "@agentclientprotocol/sdk";

export type DshUsage = {
  used: number;
  size: number;
};

export type DshTextItem = {
  kind: "user" | "assistant" | "thought";
  id: string;
  text: string;
};

export type DshToolItem = {
  kind: "tool";
  id: string;
  toolCallId: string;
  title: string;
  toolName?: string | null;
  toolKind?: string | null;
  status?: ToolCallStatus | null;
  preview: string;
  rawInput?: unknown;
  rawOutput?: unknown;
};

export type DshNoticeItem = {
  kind: "notice";
  id: string;
  tone: "info" | "error";
  text: string;
};

export type DshItem = DshTextItem | DshToolItem | DshNoticeItem;

export type DshPlan = {
  planId: string;
  entries: PlanEntry[];
  markdown?: string;
  files?: string[];
};

export type DshSessionState = {
  sessionId: string;
  seq: number;
  items: DshItem[];
  busy: boolean;
  stopReason: string | null;
  configOptions: SessionConfigOption[];
  commands: AvailableCommand[];
  plan: DshPlan | null;
  title: string | null;
  usage: DshUsage | null;
  updatedAt: number;
};

const DEFAULT_PLAN_ID = "main";

export function createDshSessionState(
  sessionId: string,
  now = Date.now(),
): DshSessionState {
  return {
    sessionId,
    seq: 0,
    items: [],
    busy: false,
    stopReason: null,
    configOptions: [],
    commands: [],
    plan: null,
    title: null,
    usage: null,
    updatedAt: now,
  };
}

function nextId(state: DshSessionState, prefix: string): string {
  state.seq += 1;
  return `${prefix}${state.seq}`;
}

function contentText(content: ContentBlock): string {
  switch (content.type) {
    case "text":
      return content.text;
    case "resource_link":
      return `[${content.name}](${content.uri})`;
    case "resource":
      return "text" in content.resource
        ? (content.resource.text ?? `[resource ${content.resource.uri}]`)
        : `[resource ${content.resource.uri}]`;
    case "image":
      return "[image]";
    case "audio":
      return "[audio]";
    default:
      return "";
  }
}

function toolPreview(content: ToolCallContent[] | undefined): string {
  if (!content || content.length === 0) return "";
  const parts: string[] = [];
  for (const entry of content) {
    if (entry.type === "content") {
      const text = contentText(entry.content);
      if (text) parts.push(text);
    } else if (entry.type === "diff") {
      parts.push(`diff ${entry.path}`);
    } else if (entry.type === "terminal") {
      parts.push(`terminal ${entry.terminalId}`);
    }
  }
  return parts.join("\n");
}

function appendText(
  state: DshSessionState,
  kind: "assistant" | "thought",
  text: string,
): void {
  if (!text) return;
  const last = state.items[state.items.length - 1];
  if (last && last.kind === kind) {
    last.text += text;
    return;
  }
  state.items.push({ kind, id: nextId(state, kind[0]), text });
}

function upsertTool(
  state: DshSessionState,
  update: {
    toolCallId: string;
    title?: string | null;
    name?: string | null;
    kind?: string | null;
    status?: ToolCallStatus | null;
    content?: ToolCallContent[] | null;
    rawInput?: unknown;
    rawOutput?: unknown;
  },
): void {
  let item: DshToolItem | undefined;
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const candidate = state.items[i];
    if (candidate.kind === "tool" && candidate.toolCallId === update.toolCallId) {
      item = candidate;
      break;
    }
  }
  if (!item) {
    item = {
      kind: "tool",
      id: nextId(state, "t"),
      toolCallId: update.toolCallId,
      title: update.title ?? update.toolCallId,
      preview: "",
    };
    state.items.push(item);
  }
  if (update.title != null) item.title = update.title;
  if (update.name !== undefined) item.toolName = update.name;
  if (update.kind !== undefined) item.toolKind = update.kind;
  if (update.status !== undefined) item.status = update.status;
  if (update.content != null) item.preview = toolPreview(update.content);
  if (update.rawInput !== undefined) item.rawInput = update.rawInput;
  if (update.rawOutput !== undefined) item.rawOutput = update.rawOutput;
}

function setPlan(
  state: DshSessionState,
  planId: string,
  patch: Partial<Omit<DshPlan, "planId">>,
): void {
  const current =
    state.plan && state.plan.planId === planId
      ? state.plan
      : { planId, entries: [] };
  state.plan = { ...current, ...patch, planId };
}

/** Folds one ACP session update into the console transcript. */
export function applyDshUpdate(
  state: DshSessionState,
  update: SessionUpdate,
  now = Date.now(),
): DshSessionState {
  state.updatedAt = now;
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      appendText(state, "assistant", contentText(update.content));
      break;
    case "agent_thought_chunk":
      appendText(state, "thought", contentText(update.content));
      break;
    case "user_message_chunk":
      // The console renders its own user turns; the echo would duplicate them.
      break;
    case "tool_call":
      upsertTool(state, update);
      break;
    case "tool_call_update":
      upsertTool(state, update);
      break;
    case "plan":
      setPlan(state, DEFAULT_PLAN_ID, { entries: update.entries });
      break;
    case "plan_update": {
      const planId = update.plan.planId;
      const content = update.plan;
      if (content.type === "items") {
        setPlan(state, planId, { entries: content.entries });
      } else if (content.type === "markdown") {
        setPlan(state, planId, {
          markdown: content.content,
          entries: state.plan?.entries ?? [],
        });
      } else if (content.type === "file") {
        const files = new Set(state.plan?.files ?? []);
        files.add(content.uri);
        setPlan(state, planId, { files: [...files] });
      }
      break;
    }
    case "plan_removed":
      if (!state.plan || state.plan.planId === update.planId) {
        state.plan = null;
      }
      break;
    case "available_commands_update":
      state.commands = update.availableCommands;
      break;
    case "config_option_update":
      state.configOptions = update.configOptions;
      break;
    case "current_mode_update":
      break;
    case "session_info_update":
      if (update.title !== undefined) state.title = update.title;
      break;
    case "usage_update":
      state.usage = { used: update.used, size: update.size };
      break;
    case "compaction_update":
      state.items.push({
        kind: "notice",
        id: nextId(state, "n"),
        tone: "info",
        text: "DSH compacted the conversation.",
      });
      break;
    case "compaction_summary_chunk":
      break;
    default:
      break;
  }
  return state;
}

export function appendUserTurn(
  state: DshSessionState,
  text: string,
  now = Date.now(),
): DshSessionState {
  state.updatedAt = now;
  state.items.push({ kind: "user", id: nextId(state, "u"), text });
  return state;
}

export function setPromptRunning(
  state: DshSessionState,
  busy: boolean,
  stopReason: string | null = null,
  now = Date.now(),
): DshSessionState {
  state.updatedAt = now;
  state.busy = busy;
  state.stopReason = busy ? null : stopReason;
  return state;
}

export function appendNotice(
  state: DshSessionState,
  text: string,
  tone: "info" | "error" = "error",
  now = Date.now(),
): DshSessionState {
  state.updatedAt = now;
  state.items.push({
    kind: "notice",
    id: nextId(state, "n"),
    tone,
    text,
  });
  return state;
}
