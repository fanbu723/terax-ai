import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_MODE,
  normalizePermissionMode,
  PERMISSION_MODES,
} from "./permissions";

describe("permission modes", () => {
  it("defaults to assisted", () => {
    expect(DEFAULT_PERMISSION_MODE).toBe("assisted");
  });

  it("lists every mode once", () => {
    expect(PERMISSION_MODES).toEqual(["manual", "assisted", "allow-all"]);
    expect(new Set(PERMISSION_MODES).size).toBe(PERMISSION_MODES.length);
  });

  it.each(PERMISSION_MODES)("keeps the known mode %s", (mode) => {
    expect(normalizePermissionMode(mode)).toBe(mode);
  });

  it.each([undefined, null, "", "always", 42, {}])(
    "falls back for the unknown value %s",
    (value) => {
      expect(normalizePermissionMode(value)).toBe("assisted");
    },
  );
});
