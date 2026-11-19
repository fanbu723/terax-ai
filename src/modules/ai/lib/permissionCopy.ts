/**
 * User-facing copy for the three permission modes.
 *
 * Labels live in one place so the composer switcher, the mini-window warning
 * strip and the Settings block cannot drift apart.
 */

import type { TFunction } from "@/i18n";
import {
  FlashIcon,
  Shield01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import type { PermissionMode } from "./permissions";

export const PERMISSION_MODE_ICONS = {
  manual: Shield01Icon,
  assisted: SparklesIcon,
  "allow-all": FlashIcon,
} as const satisfies Record<PermissionMode, typeof Shield01Icon>;

export function permissionModeLabel(
  mode: PermissionMode,
  t: TFunction,
): string {
  switch (mode) {
    case "manual":
      return t("Manual permissions");
    case "assisted":
      return t("Assisted permissions");
    case "allow-all":
      return t("Allow all");
  }
}

export function permissionModeDescription(
  mode: PermissionMode,
  t: TFunction,
): string {
  switch (mode) {
    case "manual":
      return t("Asks before every mutating tool call.");
    case "assisted":
      return t("Evaluates risk before running tools.");
    case "allow-all":
      return t("Runs tool calls without asking.");
  }
}
