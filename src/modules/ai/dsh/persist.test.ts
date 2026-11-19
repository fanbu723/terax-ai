import { describe, expect, it } from "vitest";
import { buildPersistedState, restoreSessions } from "./persist";
import {
  appendUserTurn,
  createDshSessionState,
  type DshSessionState,
} from "./updates";

function makeSession(
  id: string,
  updatedAt: number,
  items = 1,
): DshSessionState {
  const state = createDshSessionState(id, updatedAt);
  for (let i = 0; i < items; i += 1) appendUserTurn(state, `m${i}`);
  state.updatedAt = updatedAt;
  return state;
}

describe("buildPersistedState", () => {
  it("keeps the newest sessions and their newest items", () => {
    const sessions: Record<string, DshSessionState> = {};
    for (let i = 0; i < 25; i += 1) {
      sessions[`s${i}`] = makeSession(`s${i}`, i);
    }
    sessions.s24 = makeSession("s24", 100, 320);
    const state = buildPersistedState(sessions, { chat: "s24", old: "s0" });
    expect(Object.keys(state.sessions)).toHaveLength(20);
    expect(state.sessions.s24?.items).toHaveLength(300);
    expect(state.sessions.s0).toBeUndefined();
    expect(state.currentByChat).toEqual({ chat: "s24" });
  });

  it("drops chat mappings whose session was pruned", () => {
    const sessions: Record<string, DshSessionState> = {};
    for (let i = 0; i < 21; i += 1) sessions[`s${i}`] = makeSession(`s${i}`, i);
    const state = buildPersistedState(sessions, {
      kept: "s20",
      dropped: "s0",
    });
    expect(state.currentByChat).toEqual({ kept: "s20" });
  });
});

describe("restoreSessions", () => {
  it("rebuilds session state with ids and sequence numbers", () => {
    const state = buildPersistedState({ s1: makeSession("s1", 5, 3) }, {});
    const restored = restoreSessions(state);
    const restoredSession = restored.s1;
    expect(restoredSession?.items).toHaveLength(3);
    expect(restoredSession?.seq).toBe(3);
    expect(restoredSession?.updatedAt).toBe(5);
    expect(restoredSession?.busy).toBe(false);
  });

  it("returns an empty map for missing state", () => {
    expect(restoreSessions(null)).toEqual({});
  });
});
