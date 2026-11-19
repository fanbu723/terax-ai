// Minimal i18n runtime.
//
// English is the source of truth and the fallback: translation keys ARE the
// English copy (`t("Save")`), so there is no `en` resource file to keep in
// sync and an English edit upstream degrades to English instead of showing a
// raw key. Non-English dictionaries are loaded on demand by `setLocale`, so
// they never enter the startup bundle.

export type Locale = "en" | "zh-CN";

export type TFunction = (
  source: string,
  vars?: Record<string, string | number>,
) => string;

const LOCALES: readonly Locale[] = ["en", "zh-CN"];

const loaders: Record<Locale, () => Promise<Record<string, string>>> = {
  en: async () => ({}),
  "zh-CN": () => import("./locales/zh-CN").then((m) => m.default),
};

const empty: Record<string, string> = {};

let locale: Locale = "en";
let dict: Record<string, string> = empty;
const listeners = new Set<() => void>();

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/** Map a BCP-47 tag onto a supported locale. Chinese variants all share zh-CN. */
export function detectLocale(languageTag: string): Locale {
  return languageTag.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function getLocale(): Locale {
  return locale;
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * `"Save|menu"` distinguishes two contexts that share English copy. Lookup
 * tries the qualified key first, then the bare source, so an entry may be
 * added for either without breaking the other.
 */
function lookup(source: string): string | undefined {
  const exact = dict[source];
  if (exact !== undefined) return exact;
  const bar = source.indexOf("|");
  return bar > 0 ? dict[source.slice(0, bar)] : undefined;
}

function baseSource(source: string): string {
  const bar = source.indexOf("|");
  return bar > 0 ? source.slice(0, bar) : source;
}

function interpolate(
  text: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

export const t: TFunction = (source, vars) => {
  const translated = locale === "en" ? undefined : lookup(source);
  return interpolate(translated ?? baseSource(source), vars);
};

/** Keep `<html lang>` in step so assistive tech and CSS see the UI language. */
function syncDocumentLanguage(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

export async function setLocale(next: Locale): Promise<void> {
  if (next === locale && (next === "en" || dict !== empty)) return;
  dict = next === "en" ? empty : await loaders[next]();
  locale = next;
  syncDocumentLanguage();
  for (const cb of listeners) cb();
}
