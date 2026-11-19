import { useT } from "@/i18n/useT";
import { cn } from "@/lib/utils";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const t = useT();
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      // @ts-ignore
      strokeWidth={2}
      role="status"
      aria-label={t("Loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
