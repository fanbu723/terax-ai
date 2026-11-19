/**
 * Per-session permission mode.
 *
 * The Settings value (`agentPermissionMode`) is the default for new sessions
 * and for sessions the user never overrode. A composer switch pins the mode
 * for the current session only; the map is deliberately in-memory, so a new
 * app run starts every session at the configured default. That keeps
 * `allow-all` from silently surviving a restart.
 */

import { usePreferencesStore } from "@/modules/settings/preferences";
import { create } from "zustand";
import {
  DEFAULT_PERMISSION_MODE,
  normalizePermissionMode,
  type PermissionMode,
} from "../lib/permissions";

type State = {
  bySession: Record<string, PermissionMode>;
  /** Mode actually in effect for a session (override, else the default). */
  getMode: (sessionId: string | null | undefined) => PermissionMode;
  setMode: (sessionId: string, mode: PermissionMode) => void;
  /** Drop a session's override, e.g. when the session is deleted. */
  clearMode: (sessionId: string) => void;
  reset: () => void;
};

export const usePermissionStore = create<State>((set, get) => ({
  bySession: {},
  getMode: (sessionId) => {
    if (sessionId) {
      const override = get().bySession[sessionId];
      if (override) return override;
    }
    return normalizePermissionMode(
      usePreferencesStore.getState().agentPermissionMode ??
        DEFAULT_PERMISSION_MODE,
    );
  },
  setMode: (sessionId, mode) =>
    set((state) => ({
      bySession: { ...state.bySession, [sessionId]: mode },
    })),
  clearMode: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.bySession)) return state;
      const next = { ...state.bySession };
      delete next[sessionId];
      return { bySession: next };
    }),
  reset: () => set({ bySession: {} }),
}));
