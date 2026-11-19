import { create } from "zustand";
import type { RemoteDialogKind } from "../types";

type DialogState = {
  dialog: RemoteDialogKind | null;
  /** Host preselected by "Connect to host" flows. */
  hostId: string | null;
  managerMode: "manage" | "connect";
  open: (
    dialog: RemoteDialogKind,
    options?: { hostId?: string | null },
  ) => void;
  close: () => void;
};

/**
 * Tiny eager-safe store. The dialog components behind it are loaded on the
 * first `open`, so neither window pays for them at startup.
 */
export const useRemoteDialogStore = create<DialogState>((set) => ({
  dialog: null,
  hostId: null,
  managerMode: "manage",
  open: (dialog, options) =>
    set({
      dialog,
      hostId: options?.hostId ?? null,
      managerMode: dialog === "connect" ? "connect" : "manage",
    }),
  close: () => set({ dialog: null, hostId: null }),
}));

export function openRemoteHosts(): void {
  useRemoteDialogStore.getState().open("hosts");
}

export function openRemoteSpace(hostId?: string | null): void {
  useRemoteDialogStore.getState().open("space", { hostId: hostId ?? null });
}

export function openRemoteConnect(): void {
  useRemoteDialogStore.getState().open("connect");
}
