import { describe, expect, it } from "vitest";
import { auditSource } from "../../scripts/i18n-audit.mjs";

// Source-side counterpart to the dictionary gate: any user-facing English that
// never became a `t()` key shows up here. Technical strings belong in
// scripts/i18n-allowlist.mjs with a reason, not behind a weakened scanner.
describe("i18n source audit", () => {
  it("has no hardcoded user-facing strings", () => {
    expect(auditSource()).toEqual([]);
  });
});
