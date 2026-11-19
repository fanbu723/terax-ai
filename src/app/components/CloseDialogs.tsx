import type { CloseManyPending } from "@/app/hooks/tabCloseGuards";
import {
  type AppCloseBlocker,
  canOptOutOfAppClosePrompt,
} from "@/app/hooks/useAppCloseGuard";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { TFunction } from "@/i18n";
import { useT } from "@/i18n/useT";
import { setConfirmCloseRunningTerminal } from "@/modules/settings/store";
import type { Tab } from "@/modules/tabs";
import { useId, useState } from "react";

type Props = {
  tabs: Tab[];
  pendingCloseTab: number | null;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  pendingTerminalCloseTab: number | null;
  onCancelTerminalClose: () => void;
  onConfirmTerminalClose: () => void;
  pendingDeleteTabs: number[] | null;
  onCancelDeleteClose: () => void;
  onConfirmDeleteClose: () => void;
  pendingCloseMany: CloseManyPending | null;
  closeManyConfirming: boolean;
  onCancelCloseMany: () => void;
  onConfirmCloseMany: () => void;
  pendingAppClose: AppCloseBlocker | null;
  onCancelAppClose: () => void;
  onConfirmAppClose: () => void;
};

function appCloseMessage(blocker: AppCloseBlocker, t: TFunction): string {
  const dirty =
    blocker.dirtyEditors === 1
      ? t("1 file has unsaved changes")
      : t("{count} files have unsaved changes", {
          count: blocker.dirtyEditors,
        });
  if (blocker.dirtyEditors > 0 && blocker.busyTerminal) {
    return t(
      "A process is still running and {dirty}. Quitting will terminate it and discard the changes.",
      { dirty },
    );
  }
  if (blocker.dirtyEditors > 0) {
    return t("{dirty}. Quitting will discard them.", {
      dirty: `${dirty.charAt(0).toUpperCase()}${dirty.slice(1)}`,
    });
  }
  return t(
    "A process is still running in a terminal. Quitting will terminate it.",
  );
}

function OptOutRow({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  const id = useId();
  const t = useT();
  return (
    <div className="-mt-3 flex items-center justify-center gap-2 sm:justify-start">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <Label
        htmlFor={id}
        className="font-normal text-[12px] text-muted-foreground"
      >
        {t("Don't ask again about running processes")}
      </Label>
    </div>
  );
}

async function persistOptOut(): Promise<void> {
  try {
    await setConfirmCloseRunningTerminal(false);
  } catch (e) {
    console.error("close-confirmation opt-out failed", e);
  }
}

function closeManyMessage(
  pending: CloseManyPending,
  tabs: Tab[],
  t: TFunction,
): string {
  const { kind, dirtyIds, busyLeafIds } = pending;
  const dirtyCount = dirtyIds.length;
  const busyCount = busyLeafIds.length;
  if (dirtyCount === 1 && busyCount === 0) {
    const dirty = tabs.find(
      (tab) => tab.kind === "editor" && dirtyIds.includes(tab.id),
    );
    return dirty?.title
      ? t('"{title}" has unsaved changes. Close it anyway?', {
          title: dirty.title,
        })
      : t("1 tab has unsaved changes. Close it anyway?");
  }
  if (dirtyCount > 0 && busyCount > 0) {
    const dirty =
      dirtyCount === 1
        ? t("1 tab has unsaved changes")
        : t("{count} tabs have unsaved changes", { count: dirtyCount });
    const busy =
      busyCount === 1
        ? t("a process is running")
        : t("{count} processes are running", { count: busyCount });
    return busyCount === 1
      ? t(
          "{dirty} and {busy}. Closing will discard the changes and terminate the process. Close anyway?",
          { dirty, busy },
        )
      : t(
          "{dirty} and {busy}. Closing will discard the changes and terminate the processes. Close anyway?",
          { dirty, busy },
        );
  }
  if (dirtyCount > 0) {
    return t(
      "{count} tabs have unsaved changes. Closing will discard them. Close anyway?",
      { count: dirtyCount },
    );
  }
  if (busyCount === 1) {
    return kind === "right"
      ? t(
          "A process is running in a tab to the right. Closing will terminate it. Close anyway?",
        )
      : t(
          "A process is running in another tab. Closing will terminate it. Close anyway?",
        );
  }
  return kind === "right"
    ? t(
        "{count} processes are running in tabs to the right. Closing will terminate them. Close anyway?",
        { count: busyCount },
      )
    : t(
        "{count} processes are running in other tabs. Closing will terminate them. Close anyway?",
        { count: busyCount },
      );
}

/** Confirmation dialogs for closing dirty editors and terminals with live processes. */
export function CloseDialogs({
  tabs,
  pendingCloseTab,
  onCancelClose,
  onConfirmClose,
  pendingTerminalCloseTab,
  onCancelTerminalClose,
  onConfirmTerminalClose,
  pendingDeleteTabs,
  onCancelDeleteClose,
  onConfirmDeleteClose,
  pendingCloseMany,
  closeManyConfirming,
  onCancelCloseMany,
  onConfirmCloseMany,
  pendingAppClose,
  onCancelAppClose,
  onConfirmAppClose,
}: Props) {
  const t = useT();
  const [optOutTerminalClose, setOptOutTerminalClose] = useState(false);
  const [optOutAppClose, setOptOutAppClose] = useState(false);
  const appCloseCanOptOut =
    pendingAppClose !== null && canOptOutOfAppClosePrompt(pendingAppClose);

  const pendingCloseTabTitle = tabs.find(
    (tab) => tab.id === pendingCloseTab,
  )?.title;

  const confirmTerminalClose = () => {
    if (optOutTerminalClose) void persistOptOut();
    setOptOutTerminalClose(false);
    onConfirmTerminalClose();
  };

  const cancelTerminalClose = () => {
    setOptOutTerminalClose(false);
    onCancelTerminalClose();
  };

  // The pref write has to land before the window closes, or quitting drops it.
  const confirmAppClose = async () => {
    const optOut = appCloseCanOptOut && optOutAppClose;
    setOptOutAppClose(false);
    if (optOut) await persistOptOut();
    onConfirmAppClose();
  };

  const cancelAppClose = () => {
    setOptOutAppClose(false);
    onCancelAppClose();
  };

  return (
    <>
      <AlertDialog
        open={pendingCloseTab !== null}
        onOpenChange={(open) => !open && onCancelClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Unsaved Changes")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCloseTabTitle
                ? t('"{title}" has unsaved changes. Close anyway?', {
                    title: pendingCloseTabTitle,
                  })
                : t("This file has unsaved changes. Close anyway?")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelClose}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmClose}>
              {t("Close Anyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingTerminalCloseTab !== null}
        onOpenChange={(open) => !open && cancelTerminalClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Close Terminal?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("A process is running. Closing this tab will terminate it.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <OptOutRow
            checked={optOutTerminalClose}
            onCheckedChange={setOptOutTerminalClose}
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelTerminalClose}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmTerminalClose}>
              {t("Close Anyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDeleteTabs !== null}
        onOpenChange={(open) => !open && onCancelDeleteClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Unsaved Changes")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteTabs?.length === 1
                ? (() => {
                    const title = tabs.find(
                      (tab) => tab.id === pendingDeleteTabs[0],
                    )?.title;
                    return title
                      ? t(
                          '"{title}" has unsaved changes. The file has been deleted. Close anyway?',
                          { title },
                        )
                      : t(
                          "This file has unsaved changes. The file has been deleted. Close anyway?",
                        );
                  })()
                : t(
                    "{count} files have unsaved changes. They have been deleted. Close all anyway?",
                    { count: pendingDeleteTabs?.length ?? 0 },
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelDeleteClose}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDeleteClose}>
              {t("Close Anyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingCloseMany !== null}
        onOpenChange={(open) => !open && onCancelCloseMany()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingCloseMany?.kind === "right"
                ? t("Close Tabs to the Right")
                : t("Close Other Tabs")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCloseMany
                ? closeManyMessage(pendingCloseMany, tabs, t)
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelCloseMany}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={closeManyConfirming}
              onClick={(event) => {
                event.preventDefault();
                onConfirmCloseMany();
              }}
            >
              {closeManyConfirming ? t("Checking...") : t("Close Anyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingAppClose !== null}
        onOpenChange={(open) => !open && cancelAppClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Quit Terax?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAppClose ? appCloseMessage(pendingAppClose, t) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {appCloseCanOptOut ? (
            <OptOutRow
              checked={optOutAppClose}
              onCheckedChange={setOptOutAppClose}
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelAppClose}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmAppClose()}>
              {t("Quit Anyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
