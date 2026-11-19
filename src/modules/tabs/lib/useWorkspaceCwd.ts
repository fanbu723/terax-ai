import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Tab } from "./useTabs";

type Result = {
  explorerRoot: string | null;
  inheritedCwdForNewTab: () => string | undefined;
};

/**
 * Explorer root and inherited cwd for the active workspace.
 *
 * `tabs` must belong to the active space and `scope` must identify that space
 * plus its environment. A remembered terminal cwd is only reused inside the
 * scope that recorded it: the bootstrap tab and other spaces' tabs can carry
 * paths from a different environment (a local launch directory while an SSH
 * space is active), and reusing one would point the explorer or a new tab at a
 * path that does not exist on the machine being browsed.
 */
export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  tabs: Tab[],
  home: string | null,
  scope = "",
): Result {
  const remembered = useRef<{ scope: string; cwd: string | null }>({
    scope,
    cwd: null,
  });

  useEffect(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) {
      remembered.current = { scope, cwd: activeTab.cwd };
    }
  }, [activeTab, scope]);

  const lastTerminalCwd =
    remembered.current.scope === scope ? remembered.current.cwd : null;

  const explorerRoot = useMemo<string | null>(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
    if (lastTerminalCwd) return lastTerminalCwd;
    const anyTerm = tabs.find((t) => t.kind === "terminal" && t.cwd);
    if (anyTerm?.kind === "terminal" && anyTerm.cwd) return anyTerm.cwd;
    return home;
  }, [activeTab, tabs, home, lastTerminalCwd]);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
    // Editor tabs inherit the last terminal's cwd (or workspace home), not
    // the file's folder — opening a new terminal from a file shouldn't
    // hijack the user's working directory context.
    return lastTerminalCwd ?? home ?? undefined;
  }, [activeTab, home, lastTerminalCwd]);

  return { explorerRoot, inheritedCwdForNewTab };
}
