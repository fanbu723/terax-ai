import { t } from "@/i18n";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { SshHost, SshHostInput, SshProbeResult } from "./types";

function trimmed(value: string | null): string | null {
  const next = value?.trim();
  return next ? next : null;
}

/** Trims the form strings and turns empty optional fields into `null`. */
export function normalizeSshHostInput(input: SshHostInput): SshHostInput {
  return {
    label: input.label.trim(),
    host: input.host.trim(),
    port: input.port,
    user: trimmed(input.user),
    identityFile: trimmed(input.identityFile),
    defaultDir: trimmed(input.defaultDir),
    remoteShell: trimmed(input.remoteShell),
  };
}

/**
 * Rust omits `None` optional fields from the JSON, so a record read back can
 * lack keys the UI type declares. Fill them in once at the IPC boundary.
 */
function normalizeSshHost(host: SshHost): SshHost {
  return {
    id: host.id,
    label: host.label,
    host: host.host,
    port: host.port ?? null,
    user: host.user ?? null,
    identityFile: host.identityFile ?? null,
    defaultDir: host.defaultDir ?? null,
    remoteShell: host.remoteShell ?? null,
  };
}

type HostsState = {
  hosts: SshHost[];
  hydrated: boolean;
  /** False when the backend has no SSH command surface (older build). */
  backendAvailable: boolean;
  loading: boolean;
  error: string | null;
  hydrate: (force?: boolean) => Promise<void>;
  add: (input: SshHostInput) => Promise<SshHost | null>;
  update: (host: SshHost) => Promise<SshHost | null>;
  remove: (id: string) => Promise<boolean>;
  probe: (hostId: string) => Promise<SshProbeResult>;
  get: (hostId: string) => SshHost | undefined;
  clearError: () => void;
};

const BACKEND_UNAVAILABLE: SshProbeResult = {
  ok: false,
  kind: "failed",
  message: "SSH is not available in this build.",
  home: null,
};

function unavailableProbe(message: string): SshProbeResult {
  return { ...BACKEND_UNAVAILABLE, message };
}

export const useSshHosts = create<HostsState>((set, get) => ({
  hosts: [],
  hydrated: false,
  backendAvailable: true,
  loading: false,
  error: null,

  hydrate: async (force = false) => {
    if (get().loading) return;
    if (get().hydrated && !force) return;
    set({ loading: true, error: null });
    try {
      const hosts = await invoke<SshHost[]>("ssh_hosts_list");
      set({
        hosts: hosts.map(normalizeSshHost),
        hydrated: true,
        backendAvailable: true,
        loading: false,
      });
    } catch (e) {
      set({
        hosts: [],
        hydrated: true,
        backendAvailable: false,
        loading: false,
        error: String(e),
      });
    }
  },

  add: async (input) => {
    try {
      const host = normalizeSshHost(
        await invoke<SshHost>("ssh_host_add", {
          host: normalizeSshHostInput(input),
        }),
      );
      set((state) => ({
        hosts: [...state.hosts, host],
        hydrated: true,
        backendAvailable: true,
        error: null,
      }));
      return host;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  update: async (host) => {
    try {
      const saved = normalizeSshHost(
        await invoke<SshHost>("ssh_host_update", { host }),
      );
      set((state) => ({
        hosts: state.hosts.map((h) => (h.id === saved.id ? saved : h)),
        error: null,
      }));
      return saved;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  remove: async (id) => {
    try {
      await invoke<void>("ssh_host_remove", { id });
      set((state) => ({
        hosts: state.hosts.filter((h) => h.id !== id),
        error: null,
      }));
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    }
  },

  probe: async (hostId) => {
    try {
      return await invoke<SshProbeResult>("ssh_probe", { id: hostId });
    } catch (e) {
      return unavailableProbe(String(e));
    }
  },

  get: (hostId) => get().hosts.find((host) => host.id === hostId),

  clearError: () => set({ error: null }),
}));

/** One-line probe outcome for toasts and inline status. */
export function describeProbe(result: SshProbeResult): string {
  switch (result.kind) {
    case "ok":
      return result.home
        ? t("Connected. Home directory: {home}", { home: result.home })
        : t("Connected.");
    case "auth-needed":
      return t(
        "Authentication is required. Open a terminal tab and authenticate once, then test again.",
      );
    case "host-key-untrusted":
      return t(
        "The host key is not trusted. Open a terminal tab and accept the key once, then test again.",
      );
    case "unreachable":
      return result.message || t("Host is unreachable.");
    case "missing-binary":
      return t(
        "OpenSSH was not found on this machine. Install an SSH client and try again.",
      );
    default:
      return result.message || t("Connection test failed.");
  }
}

export function probeSucceeded(result: SshProbeResult): boolean {
  return result.ok && result.kind === "ok";
}
