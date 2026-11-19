import { LazyStore } from "@tauri-apps/plugin-store";
import {
  createDshSessionState,
  type DshItem,
  type DshSessionState,
} from "./updates";

const STORE_PATH = "terax-ai-dsh.json";
const KEY_STATE = "state";
const MAX_ITEMS_PER_SESSION = 300;
const MAX_SESSIONS = 20;
const PERSIST_DELAY_MS = 400;

type PersistedDshSession = {
  items: DshItem[];
  title: string | null;
  updatedAt: number;
};

export type PersistedDsh = {
  version: 1;
  currentByChat: Record<string, string>;
  sessions: Record<string, PersistedDshSession>;
};

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

/** Bounded snapshot: newest 20 sessions, newest 300 items each. */
export function buildPersistedState(
  sessions: Record<string, DshSessionState>,
  currentByChat: Record<string, string>,
): PersistedDsh {
  const kept = Object.values(sessions)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
  const persistedSessions: Record<string, PersistedDshSession> = {};
  for (const session of kept) {
    persistedSessions[session.sessionId] = {
      items: session.items.slice(-MAX_ITEMS_PER_SESSION),
      title: session.title,
      updatedAt: session.updatedAt,
    };
  }
  const keptIds = new Set(kept.map((session) => session.sessionId));
  const persistedChats: Record<string, string> = {};
  for (const [chatId, sessionId] of Object.entries(currentByChat)) {
    if (keptIds.has(sessionId)) persistedChats[chatId] = sessionId;
  }
  return {
    version: 1,
    currentByChat: persistedChats,
    sessions: persistedSessions,
  };
}

export function restoreSessions(
  persisted: PersistedDsh | null,
): Record<string, DshSessionState> {
  const out: Record<string, DshSessionState> = {};
  if (!persisted) return out;
  for (const [sessionId, saved] of Object.entries(persisted.sessions)) {
    if (!Array.isArray(saved.items)) continue;
    const state = createDshSessionState(sessionId, saved.updatedAt);
    state.items = saved.items;
    // Continue ids after the highest restored suffix so a reload cannot reuse
    // an id that is still in the transcript.
    let seq = 0;
    for (const item of saved.items) {
      const suffix = Number(item.id.replace(/^\D+/, ""));
      if (Number.isFinite(suffix) && suffix > seq) seq = suffix;
    }
    state.seq = seq;
    state.title = saved.title;
    out[sessionId] = state;
  }
  return out;
}

export async function loadDshState(): Promise<PersistedDsh | null> {
  const raw = await store.get<PersistedDsh>(KEY_STATE);
  if (raw?.version !== 1) return null;
  if (
    typeof raw.currentByChat !== "object" ||
    typeof raw.sessions !== "object"
  ) {
    return null;
  }
  return raw;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced writer; the snapshot is built when the timer fires, not earlier. */
export function scheduleDshPersist(snapshot: () => PersistedDsh): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void store
      .set(KEY_STATE, snapshot())
      .then(() => store.save())
      .catch((error) => {
        console.error("[terax] failed to persist the DSH console:", error);
      });
  }, PERSIST_DELAY_MS);
}

export function flushDshPersist(snapshot: () => PersistedDsh): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  void store
    .set(KEY_STATE, snapshot())
    .then(() => store.save())
    .catch((error) => {
      console.error("[terax] failed to flush the DSH console:", error);
    });
}
