import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkLocale } from "../../scripts/i18n-check.mjs";

// The dictionary is keyed by English source copy, so it can only drift in two
// ways. Stale entries and typographic em dashes are bugs; untranslated strings
// are allowed (they fall back to English) and the dictionary is filled in
// incrementally.
const localeFile = fileURLToPath(
  new URL("./locales/zh-CN.ts", import.meta.url),
);

describe("zh-CN dictionary", () => {
  it("has no stale entries", () => {
    const { stale } = checkLocale(localeFile);
    expect(stale).toEqual([]);
  });

  it("uses no typographic em dash", () => {
    const { emDash } = checkLocale(localeFile);
    expect(emDash).toEqual([]);
  });
});
