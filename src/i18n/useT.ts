import { useSyncExternalStore } from "react";
import { getLocale, subscribe, type TFunction, t } from "./index";

/**
 * Re-renders the calling component when the language pack or locale changes.
 * No provider is needed, which matters because the main window and the
 * settings window are separate React roots.
 */
export function useT(): TFunction {
  useSyncExternalStore(subscribe, getLocale, getLocale);
  return t;
}
