import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UI_FONT_STACK } from "./fonts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubDocument(): Map<string, string> {
  const vars = new Map<string, string>();
  vi.stubGlobal("document", {
    documentElement: {
      style: {
        setProperty: (key: string, value: string) => {
          vars.set(key, value);
        },
      },
    },
    // No usable canvas: the mono resolver falls back to the bundled chain.
    createElement: () => ({ getContext: () => null }),
  });
  return vars;
}

describe("applyAppFonts", () => {
  it("writes the automatic stacks when no preference is set", async () => {
    const vars = stubDocument();
    const { applyAppFonts } = await import("./appFonts");
    applyAppFonts();
    expect(vars.get("--app-font")).toBe(DEFAULT_UI_FONT_STACK);
    expect(vars.get("--font-sans")).toBe(DEFAULT_UI_FONT_STACK);
    expect(vars.get("--font-mono")).toContain('"JetBrains Mono"');
  });

  it("uses a custom interface and code family", async () => {
    const vars = stubDocument();
    const { applyAppFonts } = await import("./appFonts");
    applyAppFonts({
      uiFontFamily: "Maple Mono NF CN",
      terminalFontFamily: "Example Mono",
    });
    expect(vars.get("--app-font")).toBe(
      '"Maple Mono NF CN", "Inter Variable", sans-serif',
    );
    expect(vars.get("--font-mono")).toMatch(/^"Example Mono", /);
  });

  it("does nothing without a document", async () => {
    const { applyAppFonts } = await import("./appFonts");
    expect(() => applyAppFonts()).not.toThrow();
  });
});
