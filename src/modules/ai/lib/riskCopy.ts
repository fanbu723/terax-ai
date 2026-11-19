/**
 * Localized copy for risk verdicts.
 *
 * Kept out of `risk.ts` so the classifier stays pure and testable without an
 * i18n runtime; the UI passes `t` in.
 */

import type { TFunction } from "@/i18n";
import type { RiskCode, RiskLevel } from "./risk";

export function riskLevelLabel(level: RiskLevel, t: TFunction): string {
  switch (level) {
    case "low":
      return t("Low risk");
    case "medium":
      return t("Medium risk");
    case "high":
      return t("High risk");
  }
}

export function riskReasonLabel(code: RiskCode, t: TFunction): string {
  switch (code) {
    case "read-only":
      return t("Read-only tool");
    case "workspace-path":
      return t("Inside the workspace");
    case "project-config":
      return t("Project configuration file");
    case "outside-workspace":
      return t("Outside the workspace");
    case "home-config":
      return t("Home configuration or credentials");
    case "system-path":
      return t("System directory");
    case "git-internals":
      return t("Git internals");
    case "unknown-location":
      return t("Unknown location");
    case "read-only-command":
      return t("Read-only command");
    case "dev-server":
      return t("Dev server");
    case "destructive-command":
      return t("Destructive command");
    case "git-history-rewrite":
      return t("Rewrites Git history");
    case "force-push":
      return t("Force push");
    case "package-publish":
      return t("Publishes a package");
    case "system-command":
      return t("System service command");
    case "package-install":
      return t("Installs dependencies");
    case "git-mutation":
      return t("Changes Git state");
    case "unknown-command":
      return t("Unrecognized command");
    case "outside-redirect":
      return t("Writes outside the workspace");
    case "delegated-agent":
      return t("Delegates to another agent");
  }
}
