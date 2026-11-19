import { create } from "zustand";

export type DshTarget = "terax" | "dsh";

type DshTargetState = {
  targetByChat: Record<string, DshTarget>;
  /** Mirror of the heavy console store's busy flag, for the eager composer. */
  busyByChat: Record<string, boolean>;
  setTarget: (chatSessionId: string, target: DshTarget) => void;
  setBusy: (chatSessionId: string, busy: boolean) => void;
};

/**
 * Kept free of the ACP client so the eager composer can read the target and
 * busy state without pulling the gateway protocol into the startup bundle.
 */
export const useDshTargetStore = create<DshTargetState>((set) => ({
  targetByChat: {},
  busyByChat: {},
  setTarget: (chatSessionId, target) =>
    set((state) => ({
      targetByChat: { ...state.targetByChat, [chatSessionId]: target },
    })),
  setBusy: (chatSessionId, busy) =>
    set((state) =>
      state.busyByChat[chatSessionId] === busy
        ? state
        : { busyByChat: { ...state.busyByChat, [chatSessionId]: busy } },
    ),
}));

export function dshTargetFor(
  state: Pick<DshTargetState, "targetByChat">,
  chatSessionId: string | null,
): DshTarget {
  if (!chatSessionId) return "terax";
  return state.targetByChat[chatSessionId] ?? "terax";
}
