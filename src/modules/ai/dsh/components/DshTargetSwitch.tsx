import { cn } from "@/lib/utils";
import { useChatStore } from "../../store/chatStore";
import { dshTargetFor, useDshTargetStore, type DshTarget } from "../target";

const TARGETS: DshTarget[] = ["terax", "dsh"];

/** Switches the agent window between Terax's own chat and the DSH console. */
export function DshTargetSwitch({
  chatSessionId,
}: {
  chatSessionId: string | null;
}) {
  const target = useDshTargetStore((s) => dshTargetFor(s, chatSessionId));
  const setTarget = useDshTargetStore((s) => s.setTarget);
  if (!chatSessionId) return null;
  return (
    <div className="flex items-center rounded-md border border-border/60 bg-card/60 p-0.5">
      {TARGETS.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={target === value}
          onClick={() => {
            setTarget(chatSessionId, value);
            // The console lives in the mini window; the composer lives in the
            // workspace bar, so surface both.
            if (value === "dsh") {
              useChatStore.getState().openMini();
              useChatStore.getState().focusInput();
            }
          }}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] transition-colors",
            target === value
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === "terax" ? "Terax" : "DSH"}
        </button>
      ))}
    </div>
  );
}
