import { t } from "@/i18n";
import type { Tab, TerminalTab } from "./useTabs";

/** Fixed stored titles whose English copy must follow the UI language. */
const GIT_HISTORY_TITLE = "Git History";
const HISTORY_BRANCH_PREFIX = "History · ";
const AI_DIFF_SUFFIX = " (AI diff)";

/**
 * Stored titles are persisted with the tab, so they may not be translated when
 * the tab is created: a language switch has to reach the labels of open tabs.
 * This maps the parts of a stored title that are our copy (the fixed Git
 * History title and its branch prefix, the AI diff suffix) and leaves user data
 * (file names, branch names, commit subjects, custom titles) untouched.
 */
function localizedStoredTitle(tab: Tab): string {
  if (tab.kind === "git-history") {
    if (tab.title === GIT_HISTORY_TITLE) return t("Git History");
    if (tab.title.startsWith(HISTORY_BRANCH_PREFIX)) {
      return t("History · {branch}", {
        branch: tab.title.slice(HISTORY_BRANCH_PREFIX.length),
      });
    }
    return tab.title;
  }
  if (tab.kind === "ai-diff" && tab.title.endsWith(AI_DIFF_SUFFIX)) {
    const name = tab.title.slice(0, -AI_DIFF_SUFFIX.length);
    return `${name} (${t("AI diff")})`;
  }
  return tab.title;
}

/** Default terminal titles (no cwd and no custom name) are copy, not user data. */
function terminalFallbackLabel(tab: TerminalTab): string {
  if (tab.blocks) return t("Blocks terminal");
  if (tab.private) return t("Private terminal");
  return t("Terminal");
}

/**
 * The label shown on a tab. Non-terminal tabs use their stored title, with the
 * fixed copy translated; terminal tabs prefer a user-set custom name, then fall
 * back to the last segment of the cwd, then to the default terminal title. The
 * translation happens here, at render time, so switching the UI language
 * relabels open tabs without rewriting persisted state. Keeping this pure makes
 * the "custom name survives a cd" invariant testable without rendering the bar;
 * the rendering components subscribe with `useT`/`useLocale` so a language
 * switch re-runs this function.
 */
export function labelFor(tab: Tab): string {
  if (tab.kind !== "terminal") return localizedStoredTitle(tab);
  if (tab.customTitle) return tab.customTitle;
  if (!tab.cwd) return terminalFallbackLabel(tab);
  const parts = tab.cwd.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}
