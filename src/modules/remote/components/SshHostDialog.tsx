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
import { useT } from "@/i18n/useT";
import { ServerStack03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useId, useState } from "react";
import {
  hasFieldErrors,
  validateSshHostInput,
  type SshHostFieldErrors,
} from "../connect";
import { describeProbe, normalizeSshHostInput, useSshHosts } from "../hosts";
import type { SshHost, SshHostInput, SshProbeResult } from "../types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  host: SshHost | null;
  onSaved?: (host: SshHost) => void;
};

function optional(value: string): string | null {
  const next = value.trim();
  return next ? next : null;
}

export function SshHostDialog({ open, onOpenChange, host, onSaved }: Props) {
  const t = useT();
  const ids = useId();
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [port, setPort] = useState("");
  const [user, setUser] = useState("");
  const [identityFile, setIdentityFile] = useState("");
  const [defaultDir, setDefaultDir] = useState("");
  const [remoteShell, setRemoteShell] = useState("");
  const [errors, setErrors] = useState<SshHostFieldErrors>({});
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState<SshProbeResult | null>(null);
  const storeError = useSshHosts((s) => s.error);

  useEffect(() => {
    if (!open) return;
    setLabel(host?.label ?? "");
    setTarget(host?.host ?? "");
    setPort(host?.port != null ? String(host.port) : "");
    setUser(host?.user ?? "");
    setIdentityFile(host?.identityFile ?? "");
    setDefaultDir(host?.defaultDir ?? "");
    setRemoteShell(host?.remoteShell ?? "");
    setErrors({});
    setProbe(null);
    useSshHosts.getState().clearError();
  }, [open, host]);

  const buildInput = (): SshHostInput => {
    const portText = port.trim();
    return normalizeSshHostInput({
      label,
      host: target,
      port: portText ? Number(portText) : null,
      user: optional(user),
      identityFile: optional(identityFile),
      defaultDir: optional(defaultDir),
      remoteShell: optional(remoteShell),
    });
  };

  const validate = (): SshHostInput | null => {
    const input = buildInput();
    const next = validateSshHostInput(input);
    setErrors(next);
    return hasFieldErrors(next) ? null : input;
  };

  const persist = async (input: SshHostInput): Promise<SshHost | null> => {
    setSaving(true);
    try {
      if (host)
        return await useSshHosts.getState().update({ ...input, id: host.id });
      return await useSshHosts.getState().add(input);
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    const input = validate();
    if (!input) return;
    const saved = await persist(input);
    if (!saved) return;
    onSaved?.(saved);
    onOpenChange(false);
  };

  const testConnection = async () => {
    const input = validate();
    if (!input) return;
    setProbe(null);
    const saved = await persist(input);
    if (!saved) return;
    setProbing(true);
    try {
      const result = await useSshHosts.getState().probe(saved.id);
      setProbe(result);
    } finally {
      setProbing(false);
    }
  };

  const needsTerminal =
    probe?.kind === "auth-needed" || probe?.kind === "host-key-untrusted";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.75">
            <HugeiconsIcon
              icon={ServerStack03Icon}
              size={16}
              strokeWidth={1.75}
            />
            {host ? t("Edit SSH host") : t("Add SSH host")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Connect to a remote machine over SSH. Leave optional fields empty to use the OpenSSH defaults.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-label`}>{t("Display name")}</Label>
            <Input
              id={`${ids}-label`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("Work server")}
            />
            {errors.label ? (
              <span className="text-[11px] text-destructive">
                {errors.label}
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-host`}>{t("Host")}</Label>
              <Input
                id={`${ids}-host`}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={t("example.com or an SSH config alias")}
                spellCheck={false}
                autoComplete="off"
              />
              {errors.host ? (
                <span className="text-[11px] text-destructive">
                  {errors.host}
                </span>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-port`}>{t("Port")}</Label>
              <Input
                id={`${ids}-port`}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
                inputMode="numeric"
              />
              {errors.port ? (
                <span className="text-[11px] text-destructive">
                  {errors.port}
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-user`}>{t("User")}</Label>
            <Input
              id={`${ids}-user`}
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder={t("Remote user name")}
              spellCheck={false}
              autoComplete="off"
            />
            {errors.user ? (
              <span className="text-[11px] text-destructive">
                {errors.user}
              </span>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-identity`}>{t("Identity file")}</Label>
            <Input
              id={`${ids}-identity`}
              value={identityFile}
              onChange={(e) => setIdentityFile(e.target.value)}
              placeholder="/home/me/.ssh/id_ed25519"
              spellCheck={false}
              autoComplete="off"
            />
            {errors.identityFile ? (
              <span className="text-[11px] text-destructive">
                {errors.identityFile}
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-dir`}>{t("Default folder")}</Label>
              <Input
                id={`${ids}-dir`}
                value={defaultDir}
                onChange={(e) => setDefaultDir(e.target.value)}
                placeholder="/home/me/project"
                spellCheck={false}
                autoComplete="off"
              />
              {errors.defaultDir ? (
                <span className="text-[11px] text-destructive">
                  {errors.defaultDir}
                </span>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-shell`}>{t("Remote shell")}</Label>
              <Input
                id={`${ids}-shell`}
                value={remoteShell}
                onChange={(e) => setRemoteShell(e.target.value)}
                placeholder="/bin/bash"
                spellCheck={false}
                autoComplete="off"
              />
              {errors.remoteShell ? (
                <span className="text-[11px] text-destructive">
                  {errors.remoteShell}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {probe ? (
          <div
            className={`rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed ${
              probe.ok
                ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-400"
                : "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-400"
            }`}
          >
            <div>{describeProbe(probe)}</div>
            {needsTerminal ? (
              <div className="mt-1 font-medium">
                {t(
                  "Open a terminal tab and authenticate once, then test again.",
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {storeError && !probe ? (
          <div className="text-[11px] text-destructive">{storeError}</div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="text-[10.5px] text-muted-foreground">
            {t("Testing saves this host first.")}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={probing || saving}
              onClick={() => void testConnection()}
            >
              {probing ? t("Testing...") : t("Test connection")}
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
            >
              {host ? t("Save") : t("Add host")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
