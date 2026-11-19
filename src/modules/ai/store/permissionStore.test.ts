import { beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => ({ agentPermissionMode: "assisted" }));

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ agentPermissionMode: prefs.agentPermissionMode }),
  },
}));

import { usePermissionStore } from "./permissionStore";

beforeEach(() => {
  prefs.agentPermissionMode = "assisted";
  usePermissionStore.getState().reset();
});

describe("permission mode store", () => {
  it("falls back to the preference default", () => {
    expect(usePermissionStore.getState().getMode("a")).toBe("assisted");
    prefs.agentPermissionMode = "manual";
    expect(usePermissionStore.getState().getMode("a")).toBe("manual");
  });

  it("normalizes an unknown stored preference", () => {
    prefs.agentPermissionMode = "nonsense";
    expect(usePermissionStore.getState().getMode("a")).toBe("assisted");
  });

  it("uses the session override over the default", () => {
    usePermissionStore.getState().setMode("a", "allow-all");
    expect(usePermissionStore.getState().getMode("a")).toBe("allow-all");
    expect(usePermissionStore.getState().getMode("b")).toBe("assisted");
  });

  it("clears an override back to the default", () => {
    usePermissionStore.getState().setMode("a", "manual");
    usePermissionStore.getState().clearMode("a");
    expect(usePermissionStore.getState().getMode("a")).toBe("assisted");
  });

  it("reset drops every session override", () => {
    usePermissionStore.getState().setMode("a", "manual");
    usePermissionStore.getState().setMode("b", "allow-all");
    usePermissionStore.getState().reset();
    expect(usePermissionStore.getState().getMode("a")).toBe("assisted");
    expect(usePermissionStore.getState().getMode("b")).toBe("assisted");
  });

  it("treats a missing session id as the default", () => {
    expect(usePermissionStore.getState().getMode(null)).toBe("assisted");
  });
});
