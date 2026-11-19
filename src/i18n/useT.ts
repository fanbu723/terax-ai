import { useSyncExternalStore } from "react";
import { getLocale, type Locale, subscribe, type TFunction, t } from "./index";

/**
 * Re-renders the calling component when the language pack or locale changes.
 * No provider is needed, which matters because the main window and the
 * settings window are separate React roots.
 */
export function useT(): TFunction {
  useSyncExternalStore(subscribe, getLocale, getLocale);
  return t;
}

/**
 * The active locale as reactive state. Use it in dependency arrays of
 * `useMemo` / `useCallback` that build translated strings: `useT` returns a
 * stable function, so the locale is what tells React the cached copy is stale.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}
