import { describe, expect, it } from "vitest";
import { DEFAULT_DSH_WEB_COMMAND, normalizeDshWebCommand } from "./store";

describe("normalizeDshWebCommand", () => {
  it("keeps a trimmed single-line command", () => {
    expect(normalizeDshWebCommand("  dsh web --no-open  ")).toBe(
      "dsh web --no-open",
    );
  });

  it("falls back for empty, multiline, oversized or control characters", () => {
    for (const value of [
      undefined,
      null,
      42,
      {},
      "",
      "   ",
      "dsh\nweb",
      `dsh ${"x".repeat(512)}`,
      "dsh\u0007",
    ]) {
      expect(normalizeDshWebCommand(value)).toBe(DEFAULT_DSH_WEB_COMMAND);
    }
  });

  it("defaults to a free port so the startup URL can be discovered", () => {
    expect(DEFAULT_DSH_WEB_COMMAND).toBe("dsh web --no-open --port 0");
  });
});
