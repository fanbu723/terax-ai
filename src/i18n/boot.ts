import { detectLocale, isLocale, type Locale, setLocale } from "./index";

/** Persisted UI language: an explicit locale, or follow the OS/webview tag. */
export type UiLanguagePref = "auto" | Locale;

export const UI_LANGUAGE_STORAGE_KEY = "terax-ui-language";
export const UI_LANGUAGE_AUTO = "auto" as const;

export function isUiLanguagePref(value: unknown): value is UiLanguagePref {
  return value === UI_LANGUAGE_AUTO || isLocale(value);
}

export function coerceUiLanguage(value: unknown): UiLanguagePref {
  return isUiLanguagePref(value) ? value : UI_LANGUAGE_AUTO;
}

/**
 * The preference store lives behind async IPC, but the first paint must not
 * wait for it: the resolved language is mirrored into localStorage so the
 * webview can pick the dictionary synchronously before rendering.
 */
export function readLanguageMirror(): UiLanguagePref {
  if (typeof window === "undefined") return UI_LANGUAGE_AUTO;
  try {
    return coerceUiLanguage(
      window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY),
    );
  } catch {
    return UI_LANGUAGE_AUTO;
  }
}

export function writeLanguageMirror(pref: UiLanguagePref): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
}

export function resolveLocale(
  pref: UiLanguagePref,
  languageTag: string,
): Locale {
  return pref === UI_LANGUAGE_AUTO ? detectLocale(languageTag) : pref;
}

function currentLanguageTag(): string {
  return typeof navigator === "undefined" ? "en" : navigator.language;
}

/**
 * Resolve and load the language pack before the React root mounts, so the
 * first frame is already localized instead of flashing English.
 */
export async function bootI18n(languageTag?: string): Promise<Locale> {
  const pref = readLanguageMirror();
  const next = resolveLocale(pref, languageTag ?? currentLanguageTag());
  await setLocale(next);
  return next;
}

/**
 * Apply a preference coming from the settings store. Keeps the localStorage
 * mirror in step so the next launch boots straight into the chosen language.
 */
export async function applyLanguagePreference(
  pref: UiLanguagePref,
  languageTag?: string,
): Promise<Locale> {
  const normalized = coerceUiLanguage(pref);
  writeLanguageMirror(normalized);
  const next = resolveLocale(normalized, languageTag ?? currentLanguageTag());
  await setLocale(next);
  return next;
}
