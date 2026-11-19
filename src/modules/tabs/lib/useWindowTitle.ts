import { useLocale } from "@/i18n/useT";
import { findLeafCwd } from "@/modules/terminal/lib/panes";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { labelFor } from "./tabLabel";
import type { Tab } from "./useTabs";

const APP_NAME = "Terax";

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

/** Label of the focused tab — for terminals, the active pane's folder. */
function tabLabel(tab: Tab | undefined): string {
  if (!tab) return "";
  if (tab.kind === "terminal") {
    const cwd = findLeafCwd(tab.paneTree, tab.activeLeafId) ?? tab.cwd;
    if (cwd) return basename(cwd);
  }
  // Stored titles (Git History, AI diff, default terminal names) are translated
  // by labelFor at render time; file names stay as they are.
  return labelFor(tab);
}

/**
 * Drives the OS window title from the focused tab + project folder, the way
 * Spotify shows the current track instead of just the app name. Without this
 * the window keeps the build-time default ("Tauri App" on Linux).
 *
 * Format: `<project> — <tab>` (e.g. `terax-ai — src`), collapsing to just the
 * project when the focused terminal sits at the project root. Falls back to the
 * app name when there's nothing to show.
 */
export function useWindowTitle(
  activeTab: Tab | undefined,
  explorerRoot: string | null,
): void {
  // Subscribe to the locale so a language switch re-renders and recomputes
  // `label`; the effect below then pushes the translated tab label to the OS title.
  useLocale();
  const project = explorerRoot ? basename(explorerRoot) : "";
  const label = tabLabel(activeTab);

  useEffect(() => {
    let title: string;
    if (project && label && label !== project) title = `${project} — ${label}`;
    else title = project || label || APP_NAME;

    document.title = title;
    void getCurrentWindow()
      .setTitle(title)
      .catch(() => {});
  }, [project, label]);
}
