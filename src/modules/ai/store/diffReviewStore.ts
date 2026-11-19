/**
 * Mutations that ran without a confirmation card.
 *
 * When the permission mode auto-approves a file mutation there is no
 * `approval-requested` moment for `AgentRunBridge` to open its review tab, so
 * the tool records the before/after snapshot here instead. The bridge opens a
 * non-activating AI diff tab per entry so the change can be reviewed after the
 * fact. Entries are capped and hold only what the diff needs.
 */

import { create } from "zustand";
import { getApprovalDecision } from "../lib/approvalDecisions";
import type { RiskCode, RiskLevel } from "../lib/risk";
import { usePlanStore } from "./planStore";

export type AutoDiffEntry = {
  toolCallId: string;
  sessionId: string | null;
  path: string;
  originalContent: string;
  proposedContent: string;
  isNewFile: boolean;
  level: RiskLevel;
  code: RiskCode;
  at: number;
};

export type AutoDiffRecord = Omit<AutoDiffEntry, "at">;

const MAX_ENTRIES = 50;

type State = {
  entries: AutoDiffEntry[];
  record: (entry: AutoDiffRecord) => void;
  clear: () => void;
};

export const useDiffReviewStore = create<State>((set) => ({
  entries: [],
  record: (entry) =>
    set((state) => {
      const entries = [
        ...state.entries.filter((e) => e.toolCallId !== entry.toolCallId),
        { ...entry, at: Date.now() },
      ];
      return { entries: entries.slice(-MAX_ENTRIES) };
    }),
  clear: () => set({ entries: [] }),
}));

/**
 * The decision for a call that executed without asking, or `null` when the
 * user had to approve it, the session is unknown, or plan mode is queueing
 * the mutation for its own review.
 */
export function autoDiffFor(
  toolCallId: string | null | undefined,
  sessionId: string | null,
): { level: RiskLevel; code: RiskCode } | null {
  if (!toolCallId || !sessionId) return null;
  const decision = getApprovalDecision(toolCallId);
  if (!decision || decision.required) return null;
  if (usePlanStore.getState().active) return null;
  return { level: decision.level, code: decision.code };
}
