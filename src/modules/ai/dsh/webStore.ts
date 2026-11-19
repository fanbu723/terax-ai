import { useEffect } from "react";
import { create } from "zustand";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { normalizeDshWebCommand } from "@/modules/settings/store";
import { useChatStore } from "../store/chatStore";
import {
  dshWebStatus,
  openDshWeb,
  startDshWeb,
  stopDshWeb,
  watchDshWeb,
  type DshWebSurface,
} from "./web";

export type DshWebPhase = "idle" | "starting" | "running" | "error";

type DshWebState = {
  phase: DshWebPhase;
  port: number | null;
  error: string | null;
  /** Re-reads the Rust-side status (e.g. after the window regains focus). */
  refresh: () => Promise<void>;
  /** Starts the server when needed and opens the official Web GUI. */
  open: () => Promise<DshWebSurface | null>;
  /** Starts the server without opening a window. */
  start: () => Promise<boolean>;
  stop: () => Promise<void>;
};

const live = () => useChatStore.getState().live;

function sessionCwd(): string | null {
  return live().getWorkspaceRoot() ?? live().getCwd();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Serializes concurrent starts; the Rust side also rejects a second start. */
let starting: Promise<boolean> | null = null;

export const useDshWebStore = create<DshWebState>((set, get) => ({
  phase: "idle",
  port: null,
  error: null,

  refresh: async () => {
    try {
      const status = await dshWebStatus();
      set(
        status
          ? { phase: "running", port: status.port, error: null }
          : { phase: "idle", port: null },
      );
    } catch (error) {
      set({ phase: "error", error: errorText(error), port: null });
    }
  },

  start: async () => {
    if (starting) return starting;
    if (get().phase === "running") return true;
    starting = (async () => {
      set({ phase: "starting", port: null, error: null });
      try {
        const status = await startDshWeb({
          command: normalizeDshWebCommand(
            usePreferencesStore.getState().dshWebCommand,
          ),
          cwd: sessionCwd(),
        });
        set({ phase: "running", port: status.port, error: null });
        return true;
      } catch (error) {
        set({ phase: "error", port: null, error: errorText(error) });
        return false;
      } finally {
        starting = null;
      }
    })();
    return starting;
  },

  open: async () => {
    if (!(await get().start())) return null;
    try {
      return await openDshWeb();
    } catch (error) {
      set({ phase: "error", error: errorText(error) });
      return null;
    }
  },

  stop: async () => {
    try {
      await stopDshWeb();
      set({ phase: "idle", port: null, error: null });
    } catch (error) {
      set({ phase: "error", error: errorText(error) });
    }
  },
}));

/**
 * Keeps the store in step with the Rust side while mounted: one status read on
 * mount, then lifecycle events (start, stop, unexpected exit).
 */
export function useDshWebSync(): void {
  const refresh = useDshWebStore((state) => state.refresh);
  useEffect(() => {
    void refresh();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void watchDshWeb((event) => {
      if (disposed) return;
      useDshWebStore.setState(
        event.running
          ? { phase: "running", port: event.port, error: null }
          : { phase: "idle", port: null },
      );
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);
}
