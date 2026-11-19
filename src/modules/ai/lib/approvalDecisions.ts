/**
 * Per-tool-call approval decisions.
 *
 * `needsApproval` runs before a tool call executes and is the only place that
 * knows both the input and the resulting verdict. The UI (approval card, tool
 * annotation) and the tools themselves (auto-approved diff review) need that
 * verdict later, keyed by the AI SDK's `toolCallId`. Entries are capped so a
 * long session cannot grow this map without bound.
 */

import type { RiskCode, RiskLevel } from "./risk";

export type ApprovalDecision = {
  toolName: string;
  required: boolean;
  level: RiskLevel;
  code: RiskCode;
};

const MAX_ENTRIES = 500;
const decisions = new Map<string, ApprovalDecision>();

export function recordApprovalDecision(
  toolCallId: string,
  decision: ApprovalDecision,
): void {
  if (!toolCallId) return;
  decisions.delete(toolCallId);
  decisions.set(toolCallId, decision);
  if (decisions.size > MAX_ENTRIES) {
    const oldest = decisions.keys().next().value;
    if (typeof oldest === "string") decisions.delete(oldest);
  }
}

export function getApprovalDecision(
  toolCallId: string | null | undefined,
): ApprovalDecision | null {
  if (!toolCallId) return null;
  return decisions.get(toolCallId) ?? null;
}

/** Test hook: decisions are process-global, like the permission gate. */
export function clearApprovalDecisions(): void {
  decisions.clear();
}
