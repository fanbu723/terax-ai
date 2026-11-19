import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { setLastWslDistro } from "@/modules/settings/store";

export type WorkspaceEnv =
  | { kind: "local" }
  | { kind: "wsl"; distro: string }
  | { kind: "ssh"; hostId: string };

export type WslDistro = {
  name: string;
  default: boolean;
  running: boolean;
};

type State = {
  env: WorkspaceEnv;
  distros: WslDistro[];
  loading: boolean;
  error: string | null;
  setEnv: (env: WorkspaceEnv) => void;
  refreshDistros: () => Promise<WslDistro[]>;
};

export const LOCAL_WORKSPACE: WorkspaceEnv = { kind: "local" };

export const useWorkspaceEnvStore = create<State>((set) => ({
  env: LOCAL_WORKSPACE,
  distros: [],
  loading: false,
  error: null,
  setEnv: (env) => {
    set({ env });
    if (env.kind === "wsl") void setLastWslDistro(env.distro);
  },
  refreshDistros: async () => {
    set({ loading: true, error: null });
    try {
      const distros = await invoke<WslDistro[]>("wsl_list_distros");
      set({ distros, loading: false });
      return distros;
    } catch (e) {
      set({ distros: [], loading: false, error: String(e) });
      return [];
    }
  },
}));

export function currentWorkspaceEnv(): WorkspaceEnv {
  return useWorkspaceEnvStore.getState().env;
}

/**
 * True only for SSH, where files and shells live on another machine. WSL stays
 * a local-process environment: search, git, formatters and language servers all
 * work against it today.
 */
export function isRemoteEnv(env: WorkspaceEnv): boolean {
  return env.kind === "ssh";
}

export function workspaceScopeKey(env: WorkspaceEnv): string {
  switch (env.kind) {
    case "wsl":
      return `wsl:${env.distro}`;
    case "ssh":
      return `ssh:${env.hostId}`;
    default:
      return "local";
  }
}

export function parseWorkspaceScopeKey(key: string): WorkspaceEnv {
  if (key.startsWith("wsl:")) {
    const distro = key.slice("wsl:".length);
    return distro ? { kind: "wsl", distro } : LOCAL_WORKSPACE;
  }
  if (key.startsWith("ssh:")) {
    const hostId = key.slice("ssh:".length);
    return hostId ? { kind: "ssh", hostId } : LOCAL_WORKSPACE;
  }
  return LOCAL_WORKSPACE;
}

export function currentWorkspaceScopeKey(): string {
  return workspaceScopeKey(currentWorkspaceEnv());
}

export async function getWslHome(distro: string): Promise<string> {
  return invoke<string>("wsl_home", { distro });
}

/** Remote `$HOME` of an SSH host, resolved by the backend over the transport. */
export async function sshHome(hostId: string): Promise<string> {
  return invoke<string>("ssh_home", { id: hostId });
}
