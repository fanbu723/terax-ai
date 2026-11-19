import { describe, expect, it } from "vitest";
import {
  DEFAULT_DSH_ACP_COMMAND,
  LEGACY_DSH_ACP_COMMAND,
  normalizeDshAcpCommand,
} from "./store";

describe("normalizeDshAcpCommand", () => {
  it("keeps a trimmed single-line command", () => {
    expect(normalizeDshAcpCommand("  dsh --profile acp  ")).toBe(
      "dsh --profile acp",
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
      "dsh\nacp",
      `dsh ${"x".repeat(512)}`,
      "dsh\u0007",
    ]) {
      expect(normalizeDshAcpCommand(value)).toBe(DEFAULT_DSH_ACP_COMMAND);
    }
  });

  it("ships the official dsh acp profile as the default", () => {
    expect(DEFAULT_DSH_ACP_COMMAND).toBe("dsh --profile acp");
  });

  it("migrates the retired gateway default but keeps custom commands", () => {
    expect(normalizeDshAcpCommand(LEGACY_DSH_ACP_COMMAND)).toBe(
      DEFAULT_DSH_ACP_COMMAND,
    );
    expect(normalizeDshAcpCommand("my-agent --acp")).toBe("my-agent --acp");
  });
});
