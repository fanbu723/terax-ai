import { t } from "@/i18n";
import { native } from "@/modules/ai/lib/native";
import type { Tab } from "@/modules/tabs";
import {
  getWslHome,
  sshHome,
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { homeDir } from "@tauri-apps/api/path";
import { type RefObject, useCallback, useEffect, useState } from "react";

async function resolveEnvHome(env: WorkspaceEnv): Promise<string> {
  switch (env.kind) {
    case "wsl":
      return getWslHome(env.distro);
    case "ssh":
      return sshHome(env.hostId);
    default:
      return (await homeDir()).replace(/\\/g, "/");
  }
}

/** Explicit per-kind equality; a WSL distro and an SSH host both pin identity. */
export function sameWorkspaceEnv(a: WorkspaceEnv, b: WorkspaceEnv): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "wsl" && b.kind === "wsl") return a.distro === b.distro;
  if (a.kind === "ssh" && b.kind === "ssh") return a.hostId === b.hostId;
  return true;
}

type Params = {
  tabsRef: RefObject<Tab[]>;
  workspaceEnv: WorkspaceEnv;
  setWorkspaceEnv: (env: WorkspaceEnv) => void;
  resetWorkspace: (home?: string) => void;
  /** Dispose live sessions and clear App-owned pane/handle ref maps. */
  clearWorkspaceState: () => void;
};

/**
 * Owns the resolved home / launch cwd. switchWorkspace runs an interactive
 * local⇄WSL switch (tears down sessions, re-authorizes home, resets tabs);
 * adoptWorkspaceEnv applies a space's env + home on restore, without teardown.
 */
export function useWorkspaceSwitcher({
  tabsRef,
  workspaceEnv,
  setWorkspaceEnv,
  resetWorkspace,
  clearWorkspaceState,
}: Params) {
  const [home, setHome] = useState<string | null>(null);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);
  const [launchCwdResolved, setLaunchCwdResolved] = useState(false);

  useEffect(() => {
    homeDir()
      .then(async (p) => {
        const normalized = p.replace(/\\/g, "/");
        setHome(normalized);
        try {
          await native.workspaceAuthorize(normalized);
        } catch {
          // Bootstrap already authorizes home from Rust; ignore.
        }
      })
      .catch(() => setHome(null));
  }, []);

  useEffect(() => {
    native
      .workspaceCurrentDir()
      .then(setLaunchCwd)
      .catch(() => setLaunchCwd(null))
      .finally(() => setLaunchCwdResolved(true));
  }, []);

  const authorizeHome = useCallback(
    async (env: WorkspaceEnv, nextHome: string) => {
      setHome(nextHome);
      setLaunchCwd(nextHome);
      // SSH roots are authorized per space by `ssh_authorize_root`; running the
      // local registry against a remote path would be the wrong machine's auth.
      if (env.kind === "ssh") return;
      try {
        await native.workspaceAuthorize(nextHome);
      } catch {
        // Non-fatal, the git panel will surface "not authorized" if needed.
      }
    },
    [],
  );

  const switchWorkspace = useCallback(
    async (env: WorkspaceEnv): Promise<boolean> => {
      if (sameWorkspaceEnv(env, workspaceEnv)) return false;
      const dirty = tabsRef.current.some((t) => t.kind === "editor" && t.dirty);
      if (dirty) {
        window.alert(
          t("Save or close unsaved editor tabs before switching workspace."),
        );
        return false;
      }

      let nextHome: string;
      try {
        nextHome = await resolveEnvHome(env);
      } catch (e) {
        window.alert(String(e));
        return false;
      }

      clearWorkspaceState();
      setWorkspaceEnv(env.kind === "local" ? LOCAL_WORKSPACE : env);
      await authorizeHome(env, nextHome);
      resetWorkspace(nextHome);
      return true;
    },
    [
      workspaceEnv,
      setWorkspaceEnv,
      resetWorkspace,
      tabsRef,
      clearWorkspaceState,
      authorizeHome,
    ],
  );

  const adoptWorkspaceEnv = useCallback(
    async (env: WorkspaceEnv): Promise<string | null> => {
      setWorkspaceEnv(env.kind === "local" ? LOCAL_WORKSPACE : env);
      let nextHome: string;
      try {
        nextHome = await resolveEnvHome(env);
      } catch {
        return null;
      }
      await authorizeHome(env, nextHome);
      return nextHome;
    },
    [setWorkspaceEnv, authorizeHome],
  );

  return {
    home,
    launchCwd,
    launchCwdResolved,
    switchWorkspace,
    adoptWorkspaceEnv,
  };
}
