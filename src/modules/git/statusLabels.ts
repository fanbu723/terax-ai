import { t } from "@/i18n";

/**
 * Backend git status labels ("Added", "Modified", ...) are English strings
 * produced in Rust. Map the status char to an explicit translation key so the
 * UI follows the language, and fall back to the raw label for unknown codes.
 */
export function gitStatusLabel(code: string, fallback: string): string {
  switch (code.trim().toUpperCase()) {
    case "A":
      return t("Added|git");
    case "M":
      return t("Modified|git");
    case "D":
      return t("Deleted|git");
    case "R":
      return t("Renamed|git");
    case "C":
      return t("Copied|git");
    case "T":
      return t("Type changed|git");
    case "U":
      return t("Unmerged|git");
    case "?":
      return t("Untracked|git");
    default:
      return fallback;
  }
}
