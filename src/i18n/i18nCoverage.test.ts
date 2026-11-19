import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_IDENTICAL_VALUES,
  ALLOWED_LATIN_TOKENS,
} from "../../scripts/i18n-allowlist.mjs";
import {
  checkLocale,
  collectDuplicateKeys,
} from "../../scripts/i18n-check.mjs";
import zh from "./locales/zh-CN";

// The dictionary is keyed by English source copy. This fork ships a complete
// pack, so the checks below are gates rather than advisory reports: a new
// `t()` call without a translation, a stale entry, a duplicate key, a missing
// placeholder or an untranslated fragment all fail `pnpm test`.
const localeFile = fileURLToPath(
  new URL("./locales/zh-CN.ts", import.meta.url),
);

const PLACEHOLDER = /\{(\w+)\}/g;
const LATIN_TOKEN = /[A-Za-z][A-Za-z0-9.+#/-]*/g;
const HAN = /[\u3400-\u9fff]/;

const ALLOWED_TOKENS = new Set(ALLOWED_LATIN_TOKENS);
const ALLOWED_IDENTICAL = new Set(ALLOWED_IDENTICAL_VALUES);

function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
}

/** Strip placeholders so `{count}` does not look like an English fragment. */
function withoutPlaceholders(value: string): string {
  return value.replace(PLACEHOLDER, " ");
}

describe("zh-CN dictionary", () => {
  it("translates every t() key", () => {
    const { missing } = checkLocale(localeFile);
    expect(missing).toEqual([]);
  });

  it("has no stale entries", () => {
    const { stale } = checkLocale(localeFile);
    expect(stale).toEqual([]);
  });

  it("uses no typographic em dash", () => {
    const { emDash } = checkLocale(localeFile);
    expect(emDash).toEqual([]);
  });

  it("has no duplicate keys", () => {
    expect(collectDuplicateKeys(localeFile)).toEqual([]);
  });

  it("keeps every placeholder from the source key", () => {
    const mismatches = Object.entries(zh)
      .filter(
        ([key, value]) =>
          placeholders(key).join(",") !== placeholders(value).join(","),
      )
      .map(
        ([key, value]) =>
          `${key} => ${value} (expected {${placeholders(key).join("}, {")}})`,
      );
    expect(mismatches).toEqual([]);
  });

  it("does not leave English fragments in Chinese values", () => {
    const unknown = new Map<string, string[]>();
    for (const [key, value] of Object.entries(zh)) {
      if (!HAN.test(value)) continue;
      const tokens = [
        ...new Set(withoutPlaceholders(value).match(LATIN_TOKEN) ?? []),
      ].filter((token) => !ALLOWED_TOKENS.has(token));
      if (tokens.length > 0) unknown.set(key, tokens);
    }
    expect([...unknown.entries()]).toEqual([]);
  });

  it("does not ship keys without a translation", () => {
    const untranslated = Object.entries(zh)
      .filter(([key, value]) => key === value && !ALLOWED_IDENTICAL.has(key))
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });
});
