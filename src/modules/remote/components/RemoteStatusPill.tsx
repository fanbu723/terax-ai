import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TFunction } from "@/i18n";
import { useT } from "@/i18n/useT";
import {
  FolderAddIcon,
  Refresh01Icon,
  ServerStack03Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { describeProbe, probeSucceeded, useSshHosts } from "../hosts";
import { openRemoteHostManager, openRemoteSpaceDialog } from "../lib/lazy";
import { reduceConnection } from "../connect";
import type { SshConnectionState } from "../types";

const STATUS_DOT: Record<SshConnectionState["status"], string> = {
  idle: "bg-muted-foreground/40",
  probing: "bg-amber-500 animate-pulse",
  connected: "bg-emerald-500",
  "auth-needed": "bg-amber-500",
  "host-key-untrusted": "bg-amber-500",
  unreachable: "bg-destructive",
  "missing-binary": "bg-destructive",
  failed: "bg-destructive",
};

function connectionTitle(state: SshConnectionState, t: TFunction) {
  switch (state.status) {
    case "idle":
      return t("Not tested yet");
    case "probing":
      return t("Testing connection...");
    case "connected":
      return state.home
        ? t("Connected. Home directory: {home}", { home: state.home })
        : t("Connected.");
    case "auth-needed":
      return t(
        "Authentication is required. Open a terminal tab and authenticate once, then test again.",
      );
    case "host-key-untrusted":
      return t(
        "The host key is not trusted. Open a terminal tab and accept the key once, then test again.",
      );
    default:
      return state.message || t("Connection test failed.");
  }
}

/**
 * Status-bar entry point for SSH workspaces: current host, connection state and
 * the remote actions. Rendered on every platform (WSL keeps its own selector).
 */
export function RemoteStatusPill() {
  const t = useT();
  const env = useWorkspaceEnvStore((s) => s.env);
  const hostId = env.kind === "ssh" ? env.hostId : null;
  const hostLabel = useSshHosts((s) =>
    hostId ? (s.hosts.find((h) => h.id === hostId)?.label ?? null) : null,
  );
  const hostExists = useSshHosts((s) =>
    hostId ? s.hosts.some((h) => h.id === hostId) : false,
  );
  const backendAvailable = useSshHosts((s) => s.backendAvailable);
  const [connection, setConnection] = useState<SshConnectionState>({
    status: "idle",
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setConnection({ status: "idle" });
    if (!hostId || !hostExists || !backendAvailable) return;
    let cancelled = false;
    setConnection({ status: "probing", hostId });
    void useSshHosts
      .getState()
      .probe(hostId)
      .then((result) => {
        if (cancelled) return;
        setConnection((state) =>
          reduceConnection(state, { type: "probe-result", hostId, result }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [hostId, hostExists, backendAvailable]);

  if (!hostId) return null;

  const test = async () => {
    setConnection({ status: "probing", hostId });
    const result = await useSshHosts.getState().probe(hostId);
    setConnection((state) =>
      reduceConnection(state, { type: "probe-result", hostId, result }),
    );
    if (probeSucceeded(result)) {
      toast.success(describeProbe(result));
    } else {
      toast.warning(describeProbe(result));
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void useSshHosts.getState().hydrate(true);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 data-[state=open]:bg-accent data-[state=open]:text-foreground"
          title={connectionTitle(connection, t)}
        >
          <HugeiconsIcon
            icon={ServerStack03Icon}
            size={13}
            strokeWidth={1.75}
          />
          <span
            className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[connection.status]}`}
            aria-hidden
          />
          <span className="max-w-32 truncate">
            {`SSH ${hostLabel ?? hostId}`}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuItem onSelect={() => void test()}>
          <HugeiconsIcon icon={Refresh01Icon} size={13} strokeWidth={1.75} />
          {connection.status === "connected"
            ? t("Reconnect")
            : t("Test connection")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void openRemoteHostManager("manage")}>
          <HugeiconsIcon icon={Settings01Icon} size={13} strokeWidth={1.75} />
          {t("Manage hosts...")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void openRemoteSpaceDialog(hostId)}>
          <HugeiconsIcon icon={FolderAddIcon} size={13} strokeWidth={1.75} />
          {t("New remote space...")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
