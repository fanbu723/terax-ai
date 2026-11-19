import { resolveFontFamily, resolveUiFontFamily } from "./fonts";

/**
 * Push the resolved UI and code font stacks into CSS variables. The UI uses
 * `--app-font` (and `--font-sans` for heading utilities); code surfaces use
 * `--font-mono`, which keeps CodeMirror, terminal block overlays and every
 * `font-mono` code snippet in step without re-rendering React.
 *
 * Both windows call this at boot with an empty preference (the automatic
 * stacks), and again from the preferences store after it hydrates or a font
 * setting changes.
 */
export function applyAppFonts(prefs?: {
  uiFontFamily?: string;
  terminalFontFamily?: string;
}): void {
  if (typeof document === "undefined") return;
  const ui = resolveUiFontFamily(prefs?.uiFontFamily ?? "");
  const mono = resolveFontFamily(prefs?.terminalFontFamily ?? "");
  const style = document.documentElement.style;
  style.setProperty("--app-font", ui);
  style.setProperty("--font-sans", ui);
  style.setProperty("--font-mono", mono);
}
