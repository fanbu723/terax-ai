import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n/useT";
import { useSpaces } from "@/modules/spaces";
import { FolderAddIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { validateRemoteDir } from "../connect";
import { authorizeRemoteRoot } from "../lib/authorize";
import { useSshHosts } from "../hosts";
import { openRemoteHostManager } from "../lib/lazy";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialHostId?: string | null;
};

type Authorized = { hostId: string; path: string; canonical: string };

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length ? (parts[parts.length - 1] as string) : path;
}

export function RemoteSpaceDialog({
  open,
  onOpenChange,
  initialHostId,
}: Props) {
  const t = useT();
  const hosts = useSshHosts((s) => s.hosts);
  const backendAvailable = useSshHosts((s) => s.backendAvailable);
  const [hostId, setHostId] = useState<string | null>(null);
  const [folder, setFolder] = useState("");
  const [authorized, setAuthorized] = useState<Authorized | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void useSshHosts.getState().hydrate();
    setAuthorized(null);
    setError(null);
    const preferred =
      initialHostId ?? useSshHosts.getState().hosts[0]?.id ?? null;
    setHostId(preferred);
    const host = preferred
      ? useSshHosts.getState().hosts.find((h) => h.id === preferred)
      : null;
    setFolder(host?.defaultDir ?? "");
  }, [open, initialHostId]);

  useEffect(() => {
    if (!open || hosts.length === 0) return;
    if (hostId && hosts.some((h) => h.id === hostId)) return;
    setHostId(hosts[0].id);
    setFolder(hosts[0].defaultDir ?? "");
    setAuthorized(null);
  }, [open, hosts, hostId]);

  const selectedHost = hostId
    ? (hosts.find((h) => h.id === hostId) ?? null)
    : null;

  const resetAuthorization = () => {
    setAuthorized(null);
    setError(null);
  };

  const selectHost = (next: string) => {
    setHostId(next);
    const host = hosts.find((h) => h.id === next);
    setFolder(host?.defaultDir ?? "");
    resetAuthorization();
  };

  const authorize = async () => {
    if (!selectedHost) {
      setError(t("Choose an SSH host first."));
      return;
    }
    const invalid = validateRemoteDir(folder);
    if (invalid) {
      setError(invalid);
      return;
    }
    setAuthorizing(true);
    setError(null);
    try {
      const canonical = await authorizeRemoteRoot(
        selectedHost.id,
        folder.trim(),
      );
      setAuthorized({
        hostId: selectedHost.id,
        path: folder.trim(),
        canonical,
      });
      toast.success(t("Remote folder is authorized."));
    } catch (e) {
      setAuthorized(null);
      setError(String(e));
    } finally {
      setAuthorizing(false);
    }
  };

  const authorizedNow =
    authorized !== null &&
    authorized.hostId === selectedHost?.id &&
    authorized.path === folder.trim();

  const create = () => {
    if (!selectedHost || !authorizedNow) return;
    const canonical = authorized.canonical;
    const meta = useSpaces.getState().create({
      name: basename(canonical) || selectedHost.label,
      root: canonical,
      env: { kind: "ssh", hostId: selectedHost.id },
    });
    useSpaces.getState().setActive(meta.id);
    toast.success(t("Remote space created."));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.75">
            <HugeiconsIcon icon={FolderAddIcon} size={16} strokeWidth={1.75} />
            {t("New remote space")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Open a remote folder over SSH. The folder must be authorized before the space can read or write it.",
            )}
          </DialogDescription>
        </DialogHeader>

        {!backendAvailable && hosts.length === 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-400">
            {t("SSH is not available in this build.")}
          </div>
        ) : hosts.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border/70 px-3 py-4">
            <span className="text-[12px] text-muted-foreground">
              {t("No SSH hosts yet. Add one to connect.")}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void openRemoteHostManager("manage")}
            >
              {t("Manage hosts...")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>{t("SSH host")}</Label>
              <Select value={selectedHost?.id ?? ""} onValueChange={selectHost}>
                <SelectTrigger className="h-8 w-full text-[12px]">
                  <SelectValue placeholder={t("Choose an SSH host")} />
                </SelectTrigger>
                <SelectContent>
                  {hosts.map((host) => (
                    <SelectItem
                      key={host.id}
                      value={host.id}
                      className="text-[12px]"
                    >
                      {host.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="remote-space-folder">{t("Remote folder")}</Label>
              <Input
                id="remote-space-folder"
                value={folder}
                onChange={(e) => {
                  setFolder(e.target.value);
                  resetAuthorization();
                }}
                placeholder="/home/me/project"
                spellCheck={false}
                autoComplete="off"
              />
              <span className="text-[10.5px] text-muted-foreground">
                {t("Absolute POSIX path on the remote machine.")}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={authorizing || !selectedHost}
                onClick={() => void authorize()}
              >
                {authorizing ? <Spinner className="mr-1.5 size-3" /> : null}
                {t("Test and authorize")}
              </Button>
              {authorizedNow ? (
                <span className="truncate text-[11px] text-emerald-600 dark:text-emerald-400">
                  {authorized.canonical}
                </span>
              ) : null}
            </div>

            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-[11.5px] leading-relaxed text-destructive">
                {error}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("Cancel")}
          </Button>
          <Button type="button" disabled={!authorizedNow} onClick={create}>
            {t("Create space")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
