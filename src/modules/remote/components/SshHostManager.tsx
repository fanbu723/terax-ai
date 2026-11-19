import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n/useT";
import {
  Delete02Icon,
  Edit02Icon,
  FolderAddIcon,
  PlusSignIcon,
  Refresh01Icon,
  ServerStack03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatSshTarget } from "../connect";
import { describeProbe, probeSucceeded, useSshHosts } from "../hosts";
import type { SshHost, SshProbeResult } from "../types";
import { RemoteSpaceDialog } from "./RemoteSpaceDialog";
import { SshHostDialog } from "./SshHostDialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "manage" | "connect";
  initialHostId?: string | null;
  /** Rendered inside the settings window instead of a modal. */
  embedded?: boolean;
};

export function SshHostManager(props: Props) {
  const t = useT();
  if (props.embedded) {
    return (
      <ManagerBody
        mode={props.mode ?? "manage"}
        initialHostId={props.initialHostId ?? null}
        embedded
      />
    );
  }
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.75">
            <HugeiconsIcon
              icon={ServerStack03Icon}
              size={16}
              strokeWidth={1.75}
            />
            {props.mode === "connect"
              ? t("Connect to SSH host")
              : t("SSH hosts")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Hosts are stored by the native backend and shared with every window.",
            )}
          </DialogDescription>
        </DialogHeader>
        <ManagerBody
          mode={props.mode ?? "manage"}
          initialHostId={props.initialHostId ?? null}
        />
      </DialogContent>
    </Dialog>
  );
}

function ManagerBody({
  mode,
  initialHostId,
  embedded = false,
}: {
  mode: "manage" | "connect";
  initialHostId: string | null;
  embedded?: boolean;
}) {
  const t = useT();
  const hosts = useSshHosts((s) => s.hosts);
  const hydrated = useSshHosts((s) => s.hydrated);
  const loading = useSshHosts((s) => s.loading);
  const backendAvailable = useSshHosts((s) => s.backendAvailable);
  const error = useSshHosts((s) => s.error);
  const [editing, setEditing] = useState<SshHost | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, SshProbeResult>>({});
  const [spaceHostId, setSpaceHostId] = useState<string | null>(null);

  useEffect(() => {
    // Re-read the native store: another window may have added or removed hosts.
    void useSshHosts.getState().hydrate(true);
  }, []);

  useEffect(() => {
    if (!initialHostId || mode !== "connect") return;
    setSpaceHostId(initialHostId);
  }, [initialHostId, mode]);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (host: SshHost) => {
    setEditing(host);
    setDialogOpen(true);
  };

  const test = async (host: SshHost) => {
    setProbingId(host.id);
    try {
      const result = await useSshHosts.getState().probe(host.id);
      setProbes((prev) => ({ ...prev, [host.id]: result }));
      if (probeSucceeded(result)) toast.success(describeProbe(result));
      else toast.warning(describeProbe(result));
    } finally {
      setProbingId(null);
    }
  };

  const remove = async (host: SshHost) => {
    if (
      !window.confirm(
        t("Remove SSH host {label}? Spaces using it fall back to local.", {
          label: host.label,
        }),
      )
    ) {
      return;
    }
    const ok = await useSshHosts.getState().remove(host.id);
    if (ok) toast.success(t("Host removed"));
  };

  const hostToConnect = spaceHostId
    ? (hosts.find((h) => h.id === spaceHostId) ?? null)
    : null;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-muted-foreground">
          {mode === "connect"
            ? t(
                "Pick a host to open a remote space. A terminal tab can authenticate once when the host needs it.",
              )
            : t("Add, edit and test SSH targets. Spaces pin one host each.")}
        </p>
        <Button size="sm" className="shrink-0 gap-1.5" onClick={openAdd}>
          <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={2} />
          {t("Add host")}
        </Button>
      </div>

      {!backendAvailable && hydrated ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-400">
          {t("SSH is not available in this build.")}
        </div>
      ) : null}

      {error && !backendAvailable ? null : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-[11.5px] text-destructive">
          {error}
        </div>
      ) : null}

      {!hydrated || (loading && hosts.length === 0) ? (
        <div className="flex items-center gap-2 py-8 text-[11.5px] text-muted-foreground">
          <Spinner className="size-3.5" />
          {t("Loading SSH hosts...")}
        </div>
      ) : hosts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
          <HugeiconsIcon
            icon={ServerStack03Icon}
            size={20}
            strokeWidth={1.5}
            className="text-muted-foreground"
          />
          <span className="text-[12px] text-muted-foreground">
            {t("No SSH hosts yet. Add one to connect.")}
          </span>
          <Button size="sm" variant="outline" onClick={openAdd}>
            {t("Add host")}
          </Button>
        </div>
      ) : (
        <ul className="flex max-h-[52vh] flex-col gap-1.5 overflow-y-auto pr-0.5">
          {hosts.map((host) => {
            const probe = probes[host.id];
            const busy = probingId === host.id;
            return (
              <li
                key={host.id}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
              >
                <HugeiconsIcon
                  icon={ServerStack03Icon}
                  size={14}
                  strokeWidth={1.75}
                  className="shrink-0 text-muted-foreground"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[12.5px] font-medium">
                    {host.label}
                  </span>
                  <span className="truncate text-[10.5px] text-muted-foreground">
                    {formatSshTarget(host)}
                    {host.defaultDir ? ` · ${host.defaultDir}` : ""}
                  </span>
                  {probe ? (
                    <span
                      className={`truncate text-[10.5px] ${
                        probe.ok
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {describeProbe(probe)}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-[11px]"
                    disabled={busy || !backendAvailable}
                    onClick={() => void test(host)}
                  >
                    {busy ? (
                      <Spinner className="size-3" />
                    ) : (
                      <HugeiconsIcon
                        icon={Refresh01Icon}
                        size={11}
                        strokeWidth={1.75}
                      />
                    )}
                    {t("Test")}
                  </Button>
                  {!embedded ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-[11px]"
                      disabled={!backendAvailable}
                      onClick={() => setSpaceHostId(host.id)}
                    >
                      <HugeiconsIcon
                        icon={FolderAddIcon}
                        size={11}
                        strokeWidth={1.75}
                      />
                      {t("Connect")}
                    </Button>
                  ) : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    title={t("Edit host")}
                    onClick={() => openEdit(host)}
                  >
                    <HugeiconsIcon
                      icon={Edit02Icon}
                      size={12}
                      strokeWidth={1.75}
                    />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    title={t("Remove host")}
                    onClick={() => void remove(host)}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      size={12}
                      strokeWidth={1.75}
                    />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <SshHostDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        host={editing}
      />

      <RemoteSpaceDialog
        open={hostToConnect !== null}
        initialHostId={hostToConnect?.id ?? null}
        onOpenChange={(next) => {
          if (!next) setSpaceHostId(null);
        }}
      />
    </div>
  );
}
