/**
 * The single `needsApproval` implementation for every mutating agent tool.
 *
 * Tools are rebuilt per request (`buildTools(ctx)`), so the returned function
 * closes over the live session and reads the current permission mode each
 * time a call arrives. Switching modes mid-stream therefore takes effect on
 * the very next tool call.
 *
 * Manual is the historical behavior: ask. Assisted asks only when the local
 * risk verdict is not `low`. Allow-all never asks — `lib/security.ts` still
 * refuses dangerous operations, and plan mode still queues mutations for
 * review.
 */

import type { ToolContext } from "../tools/context";
import {
  type ApprovalDecision,
  recordApprovalDecision,
} from "./approvalDecisions";
import { usePermissionStore } from "../store/permissionStore";
import { assessToolRisk, type RiskContext } from "./risk";

type GateContext = Pick<
  ToolContext,
  "getCwd" | "getWorkspaceRoot" | "getSessionId"
>;

export type NeedsApproval = (
  input: unknown,
  options?: { toolCallId?: string },
) => boolean;

export type GatedToolName =
  | "write_file"
  | "edit"
  | "multi_edit"
  | "create_directory"
  | "bash_run"
  | "bash_background"
  | "spawn_coding_agent"
  | "send_to_agent";

function riskContext(ctx: GateContext): RiskContext {
  const workspaceRoot = ctx.getWorkspaceRoot();
  const cwd = ctx.getCwd();
  return { workspaceRoot, cwd };
}

export function approvalFor(
  toolName: GatedToolName,
  ctx: GateContext,
): NeedsApproval {
  return (input, options) => {
    const sessionId = ctx.getSessionId();
    const mode = usePermissionStore.getState().getMode(sessionId);
    const verdict = assessToolRisk(toolName, input, riskContext(ctx));

    let required: boolean;
    if (mode === "manual") required = true;
    else if (mode === "allow-all") required = false;
    else required = verdict.level !== "low";

    const decision: ApprovalDecision = {
      toolName,
      required,
      level: verdict.level,
      code: verdict.code,
    };
    if (options?.toolCallId) {
      recordApprovalDecision(options.toolCallId, decision);
    }
    return required;
  };
}
