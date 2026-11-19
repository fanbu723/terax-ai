import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/useT";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import {
  PERMISSION_MODE_ICONS,
  permissionModeDescription,
  permissionModeLabel,
} from "../lib/permissionCopy";
import {
  normalizePermissionMode,
  PERMISSION_MODES,
  type PermissionMode,
} from "../lib/permissions";
import { useChatStore } from "../store/chatStore";
import { usePermissionStore } from "../store/permissionStore";

/**
 * Session-scoped permission mode switcher for the composer.
 *
 * The Settings value is the default; picking a mode here pins it for the
 * current session only. Switching to Allow all needs an explicit confirmation
 * because it removes the confirmation cards entirely.
 */
export function PermissionSwitcher() {
  const t = useT();
  const sessionId = useChatStore((s) => s.activeSessionId);
  const bySession = usePermissionStore((s) => s.bySession);
  const setMode = usePermissionStore((s) => s.setMode);
  const defaultMode = usePreferencesStore((s) => s.agentPermissionMode);

  const override = sessionId ? bySession[sessionId] : undefined;
  const mode = normalizePermissionMode(override ?? defaultMode);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const choose = (next: PermissionMode) => {
    if (!sessionId) return;
    if (next === "allow-all" && mode !== "allow-all") {
      setConfirmOpen(true);
      return;
    }
    setMode(sessionId, next);
  };

  const activeIcon = PERMISSION_MODE_ICONS[mode];
  const activeLabel = permissionModeLabel(mode, t);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="xs"
            variant="outline"
            className={cn(
              "flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10.5px] transition-colors",
              mode === "allow-all"
                ? "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/15"
                : "border-border/60 bg-card text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground",
            )}
            title={t("Permission mode: {mode}", { mode: activeLabel })}
          >
            <HugeiconsIcon icon={activeIcon} size={11} strokeWidth={1.75} />
            <span className="max-w-[7rem] truncate">{activeLabel}</span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={10}
              strokeWidth={2}
              className="opacity-70"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-72">
          <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {t("Permissions")}
          </div>
          {PERMISSION_MODES.map((option) => {
            const Icon = PERMISSION_MODE_ICONS[option];
            const active = option === mode;
            return (
              <DropdownMenuItem
                key={option}
                onSelect={() => choose(option)}
                className={cn(
                  "flex items-start gap-2 pr-2 text-[12px]",
                  active && "bg-accent/40",
                )}
              >
                <HugeiconsIcon
                  icon={Icon}
                  size={13}
                  strokeWidth={1.75}
                  className={cn(
                    "mt-0.5",
                    option === "allow-all" && active
                      ? "text-destructive"
                      : active
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    {permissionModeLabel(option, t)}
                    {option === "assisted" ? (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                        {t("Recommended")}
                      </span>
                    ) : null}
                  </span>
                  <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                    {permissionModeDescription(option, t)}
                  </span>
                </span>
                {active ? (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    size={12}
                    strokeWidth={2}
                    className="mt-0.5 shrink-0 text-foreground"
                  />
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Turn on Allow all?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Every tool call in this session will run without a confirmation card. Hard safety blocks and plan-mode review still apply. The default for new sessions is unchanged.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (sessionId) setMode(sessionId, "allow-all");
              }}
            >
              {t("Allow all")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
