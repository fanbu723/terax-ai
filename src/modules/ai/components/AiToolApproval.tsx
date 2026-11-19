import { Button } from "@/components/ui/button";
import type { TFunction } from "@/i18n";
import { useT } from "@/i18n/useT";
import { cn } from "@/lib/utils";
import { getApprovalDecision } from "../lib/approvalDecisions";
import { riskLevelLabel, riskReasonLabel } from "../lib/riskCopy";
import {
  Cancel01Icon,
  Edit02Icon,
  FileEditIcon,
  FilePlusIcon,
  FolderAddIcon,
  TerminalIcon,
  Tick02Icon,
  ToolsIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ToolUIPart } from "ai";
import { memo } from "react";

type Props = {
  part: Extract<ToolUIPart, { state: "approval-requested" }>;
  toolName: string;
  onRespond: (approved: boolean) => void;
};

const TOOL_ICON: Record<string, typeof FilePlusIcon> = {
  write_file: FilePlusIcon,
  edit: FileEditIcon,
  multi_edit: Edit02Icon,
  create_directory: FolderAddIcon,
  bash_run: TerminalIcon,
  bash_background: TerminalIcon,
};

/** Tool names are protocol identifiers; only the card label is copy. */
function approvalLabel(toolName: string, t: TFunction): string {
  switch (toolName) {
    case "write_file":
      return t("Write file");
    case "edit":
      return t("Edit file");
    case "multi_edit":
      return t("Edit file (batch)");
    case "create_directory":
      return t("Create directory");
    case "bash_run":
      return t("Run shell command");
    case "bash_background":
      return t("Spawn background process");
    default:
      return toolName;
  }
}

function AiToolApprovalImpl({ part, toolName, onRespond }: Props) {
  const t = useT();
  const meta = TOOL_ICON[toolName];
  const label = approvalLabel(toolName, t);
  const Icon = meta ?? ToolsIcon;
  const input = part.input as Record<string, unknown>;
  const decision = getApprovalDecision(part.toolCallId);

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="size-1.5 shrink-0 rounded-full bg-amber-500 terax-attention-pulse" />
        <HugeiconsIcon
          icon={Icon}
          size={13}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <span className="text-[12px] font-medium text-foreground">{label}</span>
        {decision ? (
          <span
            className={cn(
              "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              decision.level === "high"
                ? "bg-destructive/10 text-destructive"
                : decision.level === "medium"
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            )}
          >
            {riskLevelLabel(decision.level, t)}
          </span>
        ) : null}
        <span
          className={cn(
            "text-[10px] text-muted-foreground",
            decision ? "" : "ml-auto",
          )}
        >
          {t("needs approval")}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <PreviewBlock toolName={toolName} input={input} />
        {decision ? (
          <div className="mt-2 text-[10.5px] text-muted-foreground">
            {t("Why this asks: {reason}", {
              reason: riskReasonLabel(decision.code, t),
            })}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-1.5 border-t border-border/60 px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRespond(false)}
          className="h-7 gap-1.5 text-[11px]"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          {t("Deny")}
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={() => onRespond(true)}
          className="h-7 gap-1.5 text-[11px]"
        >
          <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} />
          {t("Approve")}
        </Button>
      </div>
    </div>
  );
}

export const AiToolApproval = memo(AiToolApprovalImpl, (a, b) => {
  // The approval card never changes content for a given approvalId — once
  // the model has emitted the approval-requested part with its input, we
  // don't want to re-render on every downstream token.
  return (
    a.toolName === b.toolName &&
    a.part.approval.id === b.part.approval.id &&
    a.onRespond === b.onRespond
  );
});

function PreviewBlock({
  toolName,
  input,
}: {
  toolName: string;
  input: Record<string, unknown>;
}) {
  const t = useT();
  if (toolName === "bash_run" || toolName === "bash_background") {
    const cwd = typeof input.cwd === "string" ? input.cwd : null;
    return (
      <div className="space-y-1.5">
        {cwd && (
          <div className="font-mono text-[10.5px] text-muted-foreground">
            {cwd}
          </div>
        )}
        <pre
          className={cn(
            "max-h-40 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed",
          )}
        >
          {String(input.command ?? "")}
        </pre>
      </div>
    );
  }
  // For file mutations we deliberately do NOT preview content here —
  // streamed write/edit content thrashes the UI and the AI diff tab is the
  // authoritative place to review the change. Show just the path + a
  // one-line size hint so the user knows what's being touched.
  if (toolName === "write_file") {
    const content = typeof input.content === "string" ? input.content : "";
    const lines = content ? content.split("\n").length : 0;
    return (
      <div className="space-y-0.5 font-mono text-[11px]">
        <div className="text-muted-foreground">{String(input.path ?? "")}</div>
        <div className="text-[10.5px] text-muted-foreground/80">
          {lines === 1 ? t("1 line") : t("{count} lines", { count: lines })} ·{" "}
          {t("review in the diff tab")}
        </div>
      </div>
    );
  }
  if (toolName === "edit") {
    const oldStr = typeof input.old_string === "string" ? input.old_string : "";
    const newStr = typeof input.new_string === "string" ? input.new_string : "";
    const removed = oldStr ? oldStr.split("\n").length : 0;
    const added = newStr ? newStr.split("\n").length : 0;
    return (
      <div className="space-y-0.5 font-mono text-[11px]">
        <div className="text-muted-foreground">
          {String(input.path ?? "")}
          {input.replace_all ? ` · ${t("replace all")}` : ""}
        </div>
        <div className="text-[10.5px] text-muted-foreground/80">
          −{removed} / +{added}{" "}
          {added === 1 && removed === 1 ? t("line") : t("lines")} ·{" "}
          {t("review in the diff tab")}
        </div>
      </div>
    );
  }
  if (toolName === "multi_edit") {
    const edits = Array.isArray(input.edits)
      ? (input.edits as Array<{ old_string?: string; new_string?: string }>)
      : [];
    return (
      <div className="space-y-0.5 font-mono text-[11px]">
        <div className="text-muted-foreground">{String(input.path ?? "")}</div>
        <div className="text-[10.5px] text-muted-foreground/80">
          {edits.length === 1
            ? t("1 edit")
            : t("{count} edits", { count: edits.length })}{" "}
          · {t("review in the diff tab")}
        </div>
      </div>
    );
  }
  if (toolName === "create_directory") {
    return (
      <div className="font-mono text-[11px] text-muted-foreground">
        {String(input.path ?? "")}
      </div>
    );
  }
  return (
    <pre className="overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed">
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}
