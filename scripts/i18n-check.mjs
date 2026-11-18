// i18n dictionary check.
//
// Keys in `src/i18n/locales/*.ts` are English source copy, so the dictionary
// can drift two ways: an entry whose English text no longer appears in `t()`
// calls (stale), or a `t()` call with no entry yet (untranslated). Stale
// entries and typographic em dashes fail the check; untranslated strings are
// reported only, so the dictionary can land incrementally.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SRC_ROOT = join(root, "src");
const LOCALES_DIR = join(SRC_ROOT, "i18n", "locales");

/** `t("...")`, also when the literal starts on the following line. */
const CALL = /\bt\(\s*\n?\s*"((?:[^"\\]|\\.)*)"/g;
/**
 * Options tables keep their copy in `label: "..."` and render it through
 * `t(option.label)`, so those literals are call sites too.
 */
const LABEL = /(?:^|[\s{,.])label:\s*"((?:[^"\\]|\\.)*)"/g;
/**
 * `"Key": "value"` or `Key: "value"`. The value may start on the next line,
 * which is how long copy is formatted.
 */
const ENTRY = /^\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*)):\s*$/;
/** Files whose `label:` string literals are rendered through `t(...)`. */
const OPTION_TABLES = /[/\\](settings|shortcuts)[/\\]/;
const ENTRY_INLINE = /^\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*)):\s*"/;
/** Comments name `t("...")` in prose; they are not call sites. */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    // Tests and the dictionary itself are not UI call sites.
    if (/\.test\.tsx?$/.test(name)) continue;
    if (path.startsWith(LOCALES_DIR)) continue;
    out.push(path);
  }
  return out;
}

/** Turn `\u2013`, `\n`, `\"` and friends into the characters JS would produce. */
function decodeEscapes(text) {
  return text.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|n|t|r|"|'|\\)/g, (m, e) => {
    if (e[0] === "u") {
      const hex = e.startsWith("u{") ? e.slice(2, -1) : e.slice(1);
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    switch (e) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      default:
        return e;
    }
  });
}

function stripComments(text) {
  return text.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
}

export function collectSourceKeys(srcRoot = SRC_ROOT) {
  const keys = new Set();
  for (const file of walk(srcRoot, [])) {
    const text = stripComments(readFileSync(file, "utf8"));
    for (const match of text.matchAll(CALL)) keys.add(decodeEscapes(match[1]));
    // Option tables only live in the settings and shortcut modules; other
    // `label:` strings are GPU debug labels and must not be treated as copy.
    if (OPTION_TABLES.test(file)) {
      for (const match of text.matchAll(LABEL)) {
        keys.add(decodeEscapes(match[1]));
      }
    }
  }
  return keys;
}

export function collectLocaleEntries(file) {
  const entries = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = ENTRY_INLINE.exec(line) ?? ENTRY.exec(line);
    if (match) entries.set(match[1] ?? match[2], line);
  }
  return entries;
}

/** `"Save|menu"` and `"Save"` satisfy each other. */
function baseKey(key) {
  const bar = key.indexOf("|");
  return bar > 0 ? key.slice(0, bar) : key;
}

/**
 * @returns {{missing: string[], stale: string[], emDash: string[], checked: number}}
 */
export function checkLocale(localeFile, srcRoot = SRC_ROOT) {
  const sourceKeys = collectSourceKeys(srcRoot);
  const sourceBases = new Set([...sourceKeys].map(baseKey));
  const entries = collectLocaleEntries(localeFile);
  const entryBases = new Set([...entries.keys()].map(baseKey));

  const missing = [...sourceKeys].filter(
    (key) => !entries.has(key) && !entryBases.has(baseKey(key)),
  );
  const stale = [...entries.keys()].filter(
    (key) => !sourceKeys.has(key) && !sourceBases.has(baseKey(key)),
  );
  // Keys mirror the English source and may legitimately contain an em dash, so
  // only the value side of each line is checked. House style prefers plain
  // punctuation in translated copy.
  const emDash = readFileSync(localeFile, "utf8")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:"(?:[^"\\]|\\.)*"|[\w$]+):\s*/, ""))
    .filter((line) => line.includes("\u2014"))
    .map((line) => line.trim());

  missing.sort();
  stale.sort();
  emDash.sort();
  return { missing, stale, emDash, checked: entries.size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { missing, stale, emDash, checked } = checkLocale(
    join(LOCALES_DIR, "zh-CN.ts"),
  );
  console.log(
    `zh-CN: ${checked} entries, ${missing.length} untranslated, ${stale.length} stale, ${emDash.length} em dashes`,
  );
  if (missing.length > 0) {
    console.log("\nUntranslated (falls back to English):");
    for (const key of missing) console.log(`  - ${key}`);
  }
  if (stale.length > 0) {
    console.log("\nStale (no matching t() call):");
    for (const key of stale) console.log(`  - ${key}`);
  }
  if (emDash.length > 0) {
    console.log("\nTypographic em dash (U+2014) in value:");
    for (const key of emDash) console.log(`  - ${key}`);
  }
  if (stale.length > 0 || emDash.length > 0) process.exitCode = 1;
}
