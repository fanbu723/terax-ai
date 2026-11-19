/**
 * One-line, automatically derived annotation for a tool call.
 *
 * The card header only carries a verb ("Edit") plus a path or command; that
 * says nothing about *what happened* once the permission modes can run a
 * call without asking. The annotation fills that gap locally (no model call,
 * no extra tokens): a short action phrase plus the permission outcome, so an
 * auto-approved mutation is visible in the transcript instead of silent.
 *
 * Only permission-gated tools are annotated — read-only calls already show
 * their path/pattern and would just duplicate the header.
 */

import type { TFunction } from "@/i18n";
import { getApprovalDecision } from "./approvalDecisions";
import { riskLevelLabel } from "./riskCopy";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function displayPath(raw: string): string {
  const parts = raw.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : raw;
}

function displayCommand(raw: string): string {
  const oneLine = raw.trim().replace(/\s+/g, " ");
  return oneLine.length > 84 ? `${oneLine.slice(0, 83)}…` : oneLine;
}

function actionFor(
  toolName: string,
  input: unknown,
  t: TFunction,
): string | null {
  const record =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const path = displayPath(str(record.path));
  switch (toolName) {
    case "write_file":
      return path ? t("Write {path}", { path }) : null;
    case "edit":
      return path ? t("Edit {path}", { path }) : null;
    case "multi_edit":
      return path ? t("Batch edit {path}", { path }) : null;
    case "create_directory":
      return path ? t("Create dir {path}", { path }) : null;
    case "bash_run": {
      const command = str(record.command);
      return command
        ? t("Run {command}", { command: displayCommand(command) })
        : null;
    }
    case "bash_background": {
      const command = str(record.command);
      return command
        ? t("Spawn {command}", { command: displayCommand(command) })
        : null;
    }
    case "spawn_coding_agent":
      return t("Start Claude Code");
    case "send_to_agent":
      return t("Message Claude Code");
    default:
      return null;
  }
}

function outcomeFor(
  state: string,
  toolCallId: string | null | undefined,
  t: TFunction,
): string | null {
  const decision = getApprovalDecision(toolCallId);
  const risk = decision ? riskLevelLabel(decision.level, t) : null;
  if (state === "approval-requested") {
    return risk
      ? t("Awaiting confirmation ({risk})", { risk })
      : t("Awaiting confirmation");
  }
  if (state === "output-denied") return t("Denied");
  if (!decision || !risk) return null;
  if (!decision.required) {
    return t("Auto-approved ({risk})", { risk });
  }
  if (state === "output-available") {
    return t("Approved ({risk})", { risk });
  }
  return null;
}

/**
 * `null` for tools that are not permission-gated, so the card renders exactly
 * as before.
 */
export function toolAnnotation(
  toolName: string,
  input: unknown,
  toolCallId: string | null | undefined,
  state: string,
  t: TFunction,
): string | null {
  const action = actionFor(toolName, input, t);
  if (!action) return null;
  const outcome = outcomeFor(state, toolCallId, t);
  return outcome ? `${action} · ${outcome}` : action;
}
