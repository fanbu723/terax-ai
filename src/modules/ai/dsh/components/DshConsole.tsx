import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { useT } from "@/i18n/useT";
import { cn } from "@/lib/utils";
import type {
  AvailableCommand,
  CreateElicitationResponse,
  ElicitationSchema,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionInfo,
  ToolCallStatus,
} from "@agentclientprotocol/sdk";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
  Clock01Icon,
  Refresh01Icon,
  PlusSignIcon,
  ToolsIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useEffect, useMemo, useState } from "react";
import {
  activeDshSession,
  useDshStore,
  type DshPendingElicitation,
  type DshPendingPermission,
} from "../store";
import type {
  DshItem,
  DshPlan,
  DshSessionState,
  DshToolItem,
} from "../updates";
import {
  buildElicitationContent,
  buildElicitationForm,
  initialElicitationValues,
  type DshFormField,
  type DshFormValues,
} from "../elicitation";

const STATUS_TONE: Record<ToolCallStatus, string> = {
  pending: "text-muted-foreground",
  in_progress: "text-amber-500",
  completed: "text-emerald-500",
  failed: "text-destructive",
};

function StatusDot({ status }: { status?: ToolCallStatus | null }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full bg-current",
        STATUS_TONE[status ?? "pending"],
      )}
    />
  );
}

function ToolRow({ item }: { item: DshToolItem }) {
  const [open, setOpen] = useState(false);
  const detail = item.preview || item.title;
  return (
    <div className="rounded-md border border-border/60 bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px]"
      >
        <StatusDot status={item.status} />
        <HugeiconsIcon
          icon={ToolsIcon}
          size={11}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {item.title}
        </span>
        <span className="shrink-0 text-[9.5px] text-muted-foreground">
          {item.status ?? "pending"}
        </span>
        {detail ? (
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={10}
            strokeWidth={2}
            className={cn(
              "shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        ) : null}
      </button>
      {open && detail ? (
        <pre className="max-h-40 overflow-auto border-t border-border/40 bg-muted/30 px-2 py-1.5 font-mono text-[10px] whitespace-pre-wrap text-muted-foreground">
          {detail}
        </pre>
      ) : null}
    </div>
  );
}

function PlanCard({ plan }: { plan: DshPlan }) {
  const t = useT();
  if (!plan.entries.length && !plan.markdown && !plan.files?.length) return null;
  const done = plan.entries.filter((e) => e.status === "completed").length;
  return (
    <div className="rounded-md border border-border/60 bg-card/60 px-2.5 py-2">
      <div className="flex items-center gap-2 text-[11px] font-medium">
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          size={12}
          strokeWidth={1.75}
          className="text-muted-foreground"
        />
        <span>{t("Plan")}</span>
        {plan.entries.length > 0 ? (
          <span className="text-[10px] font-normal text-muted-foreground">
            {t("{done}/{total} done", {
              done,
              total: plan.entries.length,
            })}
          </span>
        ) : null}
      </div>
      {plan.entries.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {plan.entries.map((entry) => (
            <li
              key={`${entry.content}::${entry.status}`}
              className="flex items-start gap-1.5 text-[11px]"
            >
              <span
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  entry.status === "completed"
                    ? "bg-emerald-500"
                    : entry.status === "in_progress"
                      ? "bg-amber-500"
                      : "bg-muted-foreground/40",
                )}
              />
              <span
                className={cn(
                  "min-w-0 flex-1",
                  entry.status === "completed"
                    ? "text-muted-foreground line-through"
                    : "text-foreground",
                )}
              >
                {entry.content}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {plan.markdown ? (
        <div className="mt-1.5 border-t border-border/40 pt-1.5">
          <MessageResponse streaming={false}>{plan.markdown}</MessageResponse>
        </div>
      ) : null}
      {plan.files?.length ? (
        <ul className="mt-1.5 space-y-0.5 border-t border-border/40 pt-1.5 font-mono text-[10px] text-muted-foreground">
          {plan.files.map((file) => (
            <li key={file} className="truncate">
              {file}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TranscriptItem({
  item,
  streaming,
}: {
  item: DshItem;
  streaming: boolean;
}) {
  const t = useT();
  if (item.kind === "user") {
    return (
      <Message from="user">
        <MessageContent>
          <p className="text-[12px] whitespace-pre-wrap wrap-break-word">
            {item.text}
          </p>
        </MessageContent>
      </Message>
    );
  }
  if (item.kind === "assistant") {
    return (
      <Message from="assistant">
        <MessageContent>
          <div className="text-[12px]">
            <MessageResponse streaming={streaming}>
              {item.text}
            </MessageResponse>
          </div>
        </MessageContent>
      </Message>
    );
  }
  if (item.kind === "thought") {
    return (
      <details className="rounded-md border border-border/40 bg-muted/20 px-2 py-1 text-[10.5px] text-muted-foreground">
        <summary className="cursor-pointer select-none">
          {t("Thought")}
        </summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">
          {item.text}
        </pre>
      </details>
    );
  }
  if (item.kind === "tool") return <ToolRow item={item} />;
  if (item.kind !== "notice") return null;
  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1.5 text-[10.5px]",
        item.tone === "error"
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-border/40 bg-muted/20 text-muted-foreground",
      )}
    >
      {item.text}
    </div>
  );
}

function PermissionCard({ pending }: { pending: DshPendingPermission }) {
  const t = useT();
  const respond = useDshStore((s) => s.respondPermission);
  const request: RequestPermissionRequest = pending.request;
  const tool = request.toolCall;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="size-1.5 shrink-0 rounded-full bg-amber-500 terax-attention-pulse" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {tool.title ?? tool.toolCallId}
        </span>
        <span className="shrink-0 text-[9.5px] text-muted-foreground">
          {t("Needs permission")}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1">
        {request.options.map((option) => {
          const allow = option.kind.startsWith("allow");
          return (
            <Button
              key={option.optionId}
              size="sm"
              variant={allow ? "default" : "ghost"}
              className="h-6 px-2 text-[10.5px]"
              onClick={() => respond(pending.key, option.optionId)}
            >
              {option.name}
            </Button>
          );
        })}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10.5px] text-muted-foreground"
          onClick={() => respond(pending.key, null)}
        >
          {t("Cancel")}
        </Button>
      </div>
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  error,
}: {
  field: DshFormField;
  value: string | boolean | string[];
  onChange: (value: string | boolean | string[]) => void;
  error: boolean;
}) {
  const t = useT();
  const inputClass = cn(
    "w-full rounded-md border bg-input/40 px-2 py-1 text-[11px] outline-none",
    error ? "border-destructive" : "border-border/60",
  );
  if (field.kind === "boolean") {
    return (
      <label className="flex items-center gap-2 text-[11px]">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.description ? (
          <span className="text-muted-foreground">{field.description}</span>
        ) : null}
      </label>
    );
  }
  if (field.kind === "multi") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-col gap-1">
        {field.options.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-2 text-[11px]"
          >
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, option.value]
                    : selected.filter((v) => v !== option.value),
                )
              }
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    );
  }
  if (field.kind === "string" && field.options.length > 0) {
    return (
      <select
        className={inputClass}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("Select…")}</option>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === "string") {
    return (
      <textarea
        className={cn(inputClass, "min-h-14 resize-y")}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      type="number"
      className={inputClass}
      min={field.minimum ?? undefined}
      max={field.maximum ?? undefined}
      step={field.integer ? 1 : "any"}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ElicitationCard({ pending }: { pending: DshPendingElicitation }) {
  const t = useT();
  const respond = useDshStore((s) => s.respondElicitation);
  const form = useMemo(
    () =>
      buildElicitationForm(
        (pending.request as { requestedSchema?: ElicitationSchema })
          .requestedSchema ?? null,
      ),
    [pending.request],
  );
  const [values, setValues] = useState<DshFormValues>(() =>
    initialElicitationValues(form),
  );
  const [errorField, setErrorField] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const submit = () => {
    const result = buildElicitationContent(form, values);
    if (!result.ok) {
      setErrorField(result.field);
      setInvalid(result.reason === "invalid");
      return;
    }
    const response: CreateElicitationResponse = {
      action: "accept",
      content: result.content,
    };
    respond(pending.key, response);
  };

  return (
    <div className="rounded-md border border-sky-500/40 bg-sky-500/5 px-2.5 py-2">
      <div className="text-[11px] font-medium text-foreground">
        {pending.request.message}
      </div>
      {form.title ? (
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          {form.title}
        </div>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        {form.fields.map((field) => (
          <div key={field.name} className="flex flex-col gap-0.5">
            <div className="text-[10px] text-muted-foreground">
              {field.title}
              {field.required ? " *" : ""}
            </div>
            <FieldControl
              field={field}
              value={values[field.name] ?? field.default}
              error={errorField === field.name}
              onChange={(value) => {
                setErrorField(null);
                setInvalid(false);
                setValues((current) => ({ ...current, [field.name]: value }));
              }}
            />
            {field.description && field.kind !== "boolean" ? (
              <div className="text-[9.5px] text-muted-foreground/80">
                {field.description}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {errorField ? (
        <div className="mt-1 text-[10px] text-destructive">
          {invalid ? t("Enter a valid value.") : t("This field is required.")}
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10.5px] text-muted-foreground"
          onClick={() => respond(pending.key, { action: "cancel" })}
        >
          {t("Cancel")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10.5px]"
          onClick={() => respond(pending.key, { action: "decline" })}
        >
          {t("Decline")}
        </Button>
        <Button
          size="sm"
          variant="default"
          className="h-6 px-2 text-[10.5px]"
          onClick={submit}
        >
          {t("Submit")}
        </Button>
      </div>
    </div>
  );
}

function flattenOptions(options: SessionConfigOption[]) {
  return options.map((option) => {
    if (option.type === "boolean") {
      return {
        id: option.id,
        name: option.name,
        type: "boolean" as const,
        value: option.currentValue,
        values: [],
      };
    }
    const values = option.options.flatMap((entry) =>
      "group" in entry
        ? entry.options.map((o) => ({ value: o.value, label: o.name }))
        : [{ value: entry.value, label: entry.name }],
    );
    return {
      id: option.id,
      name: option.name,
      type: "select" as const,
      value: option.currentValue,
      values,
    };
  });
}

function ConfigBar({
  session,
  chatSessionId,
}: {
  session: DshSessionState;
  chatSessionId: string;
}) {
  const t = useT();
  const setConfig = useDshStore((s) => s.setConfig);
  const options = useMemo(
    () => flattenOptions(session.configOptions),
    [session.configOptions],
  );
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/20 px-3 py-1.5">
      {options.map((option) =>
        option.type === "boolean" ? (
          <label
            key={option.id}
            className="flex items-center gap-1 text-[10px] text-muted-foreground"
          >
            <input
              type="checkbox"
              checked={option.value === true}
              onChange={(e) => {
                void setConfig(chatSessionId, option.id, e.target.checked);
              }}
            />
            {option.name}
          </label>
        ) : (
          <label
            key={option.id}
            className="flex items-center gap-1 text-[10px] text-muted-foreground"
            title={option.name}
          >
            <span>{option.name}</span>
            <select
              className="max-w-40 rounded border border-border/60 bg-input/40 px-1 py-0.5 text-[10px] text-foreground outline-none"
              value={String(option.value)}
              onChange={(e) => {
                void setConfig(chatSessionId, option.id, e.target.value);
              }}
            >
              {option.values.map((value) => (
                <option key={value.value} value={value.value}>
                  {value.label}
                </option>
              ))}
            </select>
          </label>
        ),
      )}
      {session.usage ? (
        <span className="ml-auto text-[9.5px] text-muted-foreground">
          {t("Context {used}/{size}", {
            used: formatTokens(session.usage.used),
            size: formatTokens(session.usage.size),
          })}
        </span>
      ) : null}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function SessionsPopover({ chatSessionId }: { chatSessionId: string }) {
  const t = useT();
  const listSessions = useDshStore((s) => s.listSessions);
  const resumeSession = useDshStore((s) => s.resumeSession);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SessionInfo[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void listSessions().then((sessions) => {
      setItems(sessions);
      setLoading(false);
    });
  }, [open, listSessions]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
          title={t("DSH sessions")}
        >
          <HugeiconsIcon icon={Clock01Icon} size={11} strokeWidth={1.75} />
          {t("Sessions")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted-foreground">
            <Spinner className="size-3" />
            {t("Loading…")}
          </div>
        ) : items.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-muted-foreground">
            {t("No DSH sessions for this workspace.")}
          </div>
        ) : (
          <ul className="max-h-72 overflow-auto">
            {items.map((info) => (
              <li key={info.sessionId}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void resumeSession(chatSessionId, info.sessionId);
                  }}
                  className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-accent"
                >
                  <span className="w-full truncate text-[11px]">
                    {info.title ?? info.sessionId}
                  </span>
                  <span className="w-full truncate font-mono text-[9.5px] text-muted-foreground">
                    {info.updatedAt ?? info.cwd}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ConnectionBar({ chatSessionId }: { chatSessionId: string }) {
  const t = useT();
  const connStatus = useDshStore((s) => s.connStatus);
  const connError = useDshStore((s) => s.connError);
  const connLogs = useDshStore((s) => s.connLogs);
  const startedAt = useDshStore((s) => s.connStartedAt);
  const retry = useDshStore((s) => s.retry);
  const disconnect = useDshStore((s) => s.disconnect);
  const session = useDshStore((s) => activeDshSession(s, chatSessionId));
  const cancelled = useDshStore((s) => s.cancel);
  const newSession = useDshStore((s) => s.newSession);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (connStatus !== "connecting" || startedAt === null) return;
    const update = () => setElapsed(Date.now() - startedAt);
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [connStatus, startedAt]);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-1.5">
      {connStatus === "ready" ? (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {t("DSH connected")}
        </span>
      ) : connStatus === "connecting" ? (
        <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Spinner className="size-2.5" />
          <span className="truncate">
            {t("Starting DSH… {seconds}s (first run downloads the gateway)", {
              seconds: Math.round(elapsed / 1000),
            })}
          </span>
        </span>
      ) : connStatus === "error" ? (
        <span className="flex min-w-0 items-center gap-1 text-[10px] text-destructive">
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
          <span className="truncate" title={connError ?? undefined}>
            {connError ?? t("DSH connection failed.")}
          </span>
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground">
          {t("DSH not connected")}
        </span>
      )}
      {(connStatus === "error" || connStatus === "connecting") &&
      connLogs.length > 0 ? (
        <details className="w-full text-[9.5px] text-muted-foreground">
          <summary className="cursor-pointer select-none">
            {t("Show log")}
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap">
            {connLogs.join("\n")}
          </pre>
        </details>
      ) : null}
      <span className="flex-1" />
      {connStatus === "connecting" ? (
        <Button
          size="xs"
          variant="ghost"
          className="h-6 px-1.5 text-[10px] text-muted-foreground"
          onClick={() => void disconnect()}
        >
          {t("Cancel")}
        </Button>
      ) : null}
      {connStatus === "error" ? (
        <Button
          size="xs"
          variant="ghost"
          className="h-6 gap-1 px-1.5 text-[10px]"
          onClick={() => void retry()}
        >
          <HugeiconsIcon icon={Refresh01Icon} size={11} strokeWidth={1.75} />
          {t("Retry")}
        </Button>
      ) : null}
      {connStatus === "ready" ? (
        <>
          <Button
            size="xs"
            variant="ghost"
            className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
            onClick={() => void newSession(chatSessionId)}
          >
            <HugeiconsIcon icon={PlusSignIcon} size={11} strokeWidth={2} />
            {t("New session")}
          </Button>
          <SessionsPopover chatSessionId={chatSessionId} />
          {session?.busy ? (
            <Button
              size="xs"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
              onClick={() => void cancelled(chatSessionId)}
            >
              <HugeiconsIcon icon={CircleIcon} size={10} strokeWidth={2} />
              {t("Stop")}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            className="h-6 px-1.5 text-[10px] text-muted-foreground"
            onClick={() => void disconnect()}
          >
            {t("Disconnect")}
          </Button>
        </>
      ) : null}
    </div>
  );
}

function CommandsPopover({ commands }: { commands: AvailableCommand[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (commands.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
          title={t("DSH commands")}
        >
          <HugeiconsIcon icon={ToolsIcon} size={11} strokeWidth={1.75} />
          {t("Commands")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        <ul className="max-h-72 overflow-auto">
          {commands.map((command) => (
            <li key={command.name}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  insertCommand(`/${command.name} `);
                }}
                className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-accent"
              >
                <span className="font-mono text-[11px]">/{command.name}</span>
                <span className="w-full truncate text-[10px] text-muted-foreground">
                  {command.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function insertCommand(prefill: string) {
  void import("../../store/chatStore").then(({ useChatStore }) => {
    useChatStore.getState().focusInput(prefill);
  });
}

export const DshConsole = memo(function DshConsole({
  chatSessionId,
}: {
  chatSessionId: string;
}) {
  const t = useT();
  const session = useDshStore((s) => activeDshSession(s, chatSessionId));
  const permissions = useDshStore((s) => s.permissions);
  const elicitations = useDshStore((s) => s.elicitations);
  const hydrate = useDshStore((s) => s.hydrate);
  const ensureConnection = useDshStore((s) => s.ensureConnection);
  const connStatus = useDshStore((s) => s.connStatus);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const sessionId = session?.sessionId ?? null;
  const pendingPermission = sessionId
    ? permissions.find((p) => p.sessionId === sessionId)
    : undefined;
  const pendingElicitation = sessionId
    ? elicitations.find((e) => e.sessionId === sessionId)
    : undefined;

  const lastAssistant = useMemo(() => {
    if (!session) return null;
    for (let i = session.items.length - 1; i >= 0; i -= 1) {
      const item = session.items[i];
      if (item?.kind === "assistant") return item.id;
    }
    return null;
  }, [session]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConnectionBar chatSessionId={chatSessionId} />
      {session ? (
        <>
          <ConfigBar session={session} chatSessionId={chatSessionId} />
          <div className="flex items-center gap-1 border-b border-border/40 px-3 py-1">
            <CommandsPopover commands={session.commands} />
            <span className="text-[9.5px] text-muted-foreground">
              {session.title ?? ""}
            </span>
          </div>
        </>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {!session || session.items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="text-[12px] font-medium text-foreground">
              {t("DSH console")}
            </div>
            <div className="max-w-64 text-[10.5px] text-muted-foreground">
              {t(
                "Send a message to start a DSH agent. It runs through `dsh-acp-gateway` with its own plan, commands and approvals.",
              )}
            </div>
            {connStatus !== "ready" ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-1 h-7 text-[11px]"
                onClick={() => void ensureConnection()}
              >
                {t("Connect")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {session.plan ? <PlanCard plan={session.plan} /> : null}
            {session.items.map((item) => (
              <TranscriptItem
                key={item.id}
                item={item}
                streaming={
                  session.busy &&
                  item.kind === "assistant" &&
                  item.id === lastAssistant
                }
              />
            ))}
          </div>
        )}
      </div>

      {pendingPermission || pendingElicitation ? (
        <div className="flex shrink-0 flex-col gap-2 border-t border-border/40 px-3 py-2">
          {pendingPermission ? (
            <PermissionCard pending={pendingPermission} />
          ) : null}
          {pendingElicitation ? (
            <ElicitationCard
              key={pendingElicitation.key}
              pending={pendingElicitation}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
