import { beforeEach, describe, expect, it } from "vitest";
import { dshTargetFor, useDshTargetStore } from "./target";

beforeEach(() => {
  useDshTargetStore.setState({ targetByChat: {}, busyByChat: {} });
});

describe("dshTargetFor", () => {
  it("defaults to the built-in agent", () => {
    expect(dshTargetFor(useDshTargetStore.getState(), null)).toBe("terax");
    expect(dshTargetFor(useDshTargetStore.getState(), "chat")).toBe("terax");
  });

  it("returns the selected target per chat session", () => {
    useDshTargetStore.getState().setTarget("chat", "dsh");
    expect(dshTargetFor(useDshTargetStore.getState(), "chat")).toBe("dsh");
    expect(dshTargetFor(useDshTargetStore.getState(), "other")).toBe("terax");
  });
});

describe("busy mirror", () => {
  it("tracks the console prompt per chat session", () => {
    const store = useDshTargetStore.getState();
    store.setBusy("chat", true);
    expect(useDshTargetStore.getState().busyByChat.chat).toBe(true);
    store.setBusy("chat", false);
    expect(useDshTargetStore.getState().busyByChat.chat).toBe(false);
  });
});
