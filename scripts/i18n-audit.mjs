// i18n source audit.
//
// The dictionary check (`i18n-check.mjs`) only sees strings that already went
// through `t()`. This audit finds the opposite gap: user-facing English that
// never became a key at all, which is what makes a partially translated UI
// read as a mix of Chinese and English.
//
// It scans JSX text, the attributes that render as copy, and the direct
// toast/alert/confirm literals. Commented-out code is ignored. The heuristic
// is intentionally conservative: exact technical strings live in
// `i18n-allowlist.mjs`, so a finding means either wrap it in `t()` or add it
// to the allow-list with a reason.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_SOURCE,
  ALLOWED_SOURCE_PATTERNS,
} from "./i18n-allowlist.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
export const SRC_ROOT = join(root, "src");

/** Tests, the dictionary itself and the dev benchmark harness are not UI. */
const SKIP = [
  /\.test\.tsx?$/,
  /[/\\]i18n[/\\]locales[/\\]/,
  /[/\\]bench[/\\]/,
];

const BLOCK_COMMENT = /(^|[\s{])\/\*[\s\S]*?\*\//gm;
const LINE_COMMENT = /^\s*\/\/.*$/gm;

/** English text between JSX tags. Braces and nested tags end the match. */
const JSX_TEXT = />([^<>{}]*[A-Za-z][^<>{}]*)</g;
/** Attributes that are read by users or assistive tech. */
const ATTRIBUTE =
  /\b(title|aria-label|aria-description|placeholder|alt|description|label)\s*=\s*"([^"]*)"/g;
/** Strings passed straight to a visible toast or native dialog. */
const DISPLAY_CALL =
  /\b(?:toast(?:\.(?:success|error|info|warning|message|loading))?|alert|confirm)\(\s*(?:"([^"]+)"|'([^']+)')/g;

const ALLOWED = new Set(ALLOWED_SOURCE);

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (SKIP.some((pattern) => pattern.test(path))) continue;
    out.push(path);
  }
  return out;
}

function stripComments(text) {
  return text.replace(BLOCK_COMMENT, "$1").replace(LINE_COMMENT, "");
}

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function isAllowed(text) {
  if (ALLOWED.has(text)) return true;
  return ALLOWED_SOURCE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * True when the literal looks like rendered copy rather than a class name,
 * expression fragment or code token.
 */
function looksLikeCopy(raw) {
  const text = normalize(raw);
  if (text.length < 2 || text.length > 400) return false;
  if (!/[A-Za-z]{2}/.test(text)) return false;
  // Already localized or mixed into Chinese copy.
  if (/[\u3400-\u9fff]/.test(text)) return false;
  if (isAllowed(text)) return false;
  // Expression leftovers the JSX-text regex can pick up.
  if (/[{}[\]|=<>`\\]/.test(text)) return false;
  if (/=>|&&|\|\||===|!==/.test(text)) return false;
  if (text.includes(";")) return false;
  if (/&\s+[A-Z]/.test(text)) return false;
  // A ternary or type annotation, not a question in copy.
  if (text.includes("?") && !text.endsWith("?")) return false;
  if (/[()]/.test(text) && !/^\([^()]*\)$/.test(text)) return false;
  if (text.startsWith(")") || text.startsWith(".") || text.startsWith(",")) {
    return false;
  }
  if (/^[A-Za-z_$][\w$]*\s*\(/.test(text)) return false;
  // Paths, URLs, selectors and code-ish fragments.
  if (/^(?:https?:\/\/|www\.)/.test(text)) return false;
  if (/^[\w.-]+\.(?:ts|tsx|js|jsx|json|md|toml|rs|py|css|html|yml|yaml)$/.test(text)) {
    return false;
  }
  if (/^[$_a-zA-Z][\w$]*(?:\.[\w$]+)*\(?\)?$/.test(text) && !/\s/.test(text)) {
    // A single identifier (function/type name), not copy. Uppercase single
    // words such as `Retry` still read as copy, so keep those.
    if (!/^[A-Z]/.test(text)) return false;
  }
  // A lone lowercase token with no space is usually code, not a label.
  if (!/\s/.test(text) && /^[a-z][\w.-]*$/.test(text)) return false;
  return true;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * @returns {{file: string, line: number, kind: string, text: string}[]}
 */
export function auditSource(srcRoot = SRC_ROOT) {
  const findings = [];
  const seen = new Set();

  const push = (file, line, kind, raw) => {
    if (!looksLikeCopy(raw)) return;
    const text = normalize(raw);
    const key = `${file}:${line}:${kind}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file: relative(root, file), line, kind, text });
  };

  for (const file of walk(srcRoot, [])) {
    const text = stripComments(readFileSync(file, "utf8"));
    if (file.endsWith(".tsx")) {
      for (const match of text.matchAll(JSX_TEXT)) {
        push(file, lineOf(text, match.index ?? 0), "jsx", match[1]);
      }
    }
    for (const match of text.matchAll(ATTRIBUTE)) {
      push(
        file,
        lineOf(text, match.index ?? 0),
        `attr:${match[1]}`,
        match[2],
      );
    }
    for (const match of text.matchAll(DISPLAY_CALL)) {
      push(file, lineOf(text, match.index ?? 0), "toast", match[1] ?? match[2]);
    }
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return findings;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = auditSource();
  const check = process.argv.includes("--check");
  if (findings.length === 0) {
    console.log("i18n audit: 0 hardcoded user-facing strings");
  } else {
    for (const finding of findings) {
      console.log(
        `${finding.file}:${finding.line}: [${finding.kind}] ${finding.text}`,
      );
    }
    console.error(`i18n audit: ${findings.length} hardcoded string(s)`);
    if (check) process.exitCode = 1;
  }
}
