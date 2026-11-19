import { getLocale, t } from "./index";

/**
 * The BCP-47 tag the UI formats dates and numbers with. It follows the UI
 * language, not the OS locale: an English UI on a Chinese system keeps English
 * date shapes instead of mixing languages inside one screen.
 */
export function localeTag(): string {
  return getLocale() === "zh-CN" ? "zh-CN" : "en-US";
}

/** Numeric date + time, e.g. `2026年11月19日 09:15`. */
export function formatDateTime(secs: number): string {
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleString(localeTag(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Compact month/day + time for dense lists. Same year drops the year, older
 * commits keep it, e.g. `11月19日 09:15` / `Nov 19 09:15`.
 */
export function formatCompactDateTime(secs: number, now = new Date()): string {
  if (!secs) return "";
  const date = new Date(secs * 1000);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleString(localeTag(), {
    month: "short",
    day: "numeric",
    ...(sameYear
      ? { hour: "2-digit", minute: "2-digit" }
      : { year: "numeric" }),
  });
}

/** Counts with the UI locale's grouping. */
export function formatNumber(value: number): string {
  return value.toLocaleString(localeTag());
}

/**
 * Relative time for agent notifications. The labels are dictionary keys, so
 * Chinese copy comes from the zh-CN pack and the English fallback stays short.
 */
export function formatRelativeTime(
  ts: number,
  now: number = Date.now(),
): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 60) return t("just now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("{count}m ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{count}h ago", { count: hours });
  return t("{count}d ago", { count: Math.floor(hours / 24) });
}
