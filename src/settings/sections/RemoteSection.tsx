import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n/useT";
import { lazy, Suspense } from "react";
import { SectionHeader } from "../components/SectionHeader";

const SshHostManager = lazy(() =>
  import("@/modules/remote/components/SshHostManager").then((m) => ({
    default: m.SshHostManager,
  })),
);

/** Settings > Remote: SSH host management for remote spaces. */
export function RemoteSection() {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t("Remote")}
        description={t(
          "SSH hosts for remote development. Spaces pin one host and an authorized remote folder.",
        )}
      />
      <Suspense
        fallback={
          <div className="flex items-center gap-2 py-6 text-[11.5px] text-muted-foreground">
            <Spinner className="size-3.5" />
            {t("Loading SSH hosts...")}
          </div>
        }
      >
        <SshHostManager embedded open onOpenChange={() => {}} />
      </Suspense>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t(
          "Create a remote space from the status bar or the command palette. Source control, search and language servers stay local for now.",
        )}
      </p>
    </div>
  );
}
