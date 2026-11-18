import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coerceUiLanguage,
  readLanguageMirror,
  resolveLocale,
  UI_LANGUAGE_STORAGE_KEY,
  writeLanguageMirror,
} from "./boot";
import {
  detectLocale,
  getLocale,
  isLocale,
  setLocale,
  subscribe,
  t,
} from "./index";

/** Tests run in the node environment, so the mirror gets a storage stub. */
function stubStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      clear: () => data.clear(),
    },
  });
  return data;
}

beforeEach(() => {
  stubStorage();
});

afterEach(async () => {
  await setLocale("en");
  vi.unstubAllGlobals();
});

describe("detectLocale", () => {
  it("maps every Chinese tag to zh-CN", () => {
    expect(detectLocale("zh-CN")).toBe("zh-CN");
    expect(detectLocale("zh")).toBe("zh-CN");
    expect(detectLocale("zh-Hant-TW")).toBe("zh-CN");
  });

  it("falls back to English for other tags", () => {
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("ja-JP")).toBe("en");
    expect(detectLocale("")).toBe("en");
  });
});

describe("t", () => {
  it("returns the English source before any pack is loaded", () => {
    expect(t("Save")).toBe("Save");
  });

  it("translates through the loaded pack", async () => {
    await setLocale("zh-CN");
    expect(t("Language")).toBe("语言");
  });

  it("falls back to English for keys the pack does not contain", async () => {
    await setLocale("zh-CN");
    expect(t("Some upstream string added later")).toBe(
      "Some upstream string added later",
    );
  });

  it("strips the context qualifier when no qualified entry exists", async () => {
    await setLocale("zh-CN");
    expect(t("Language|menu")).toBe("语言");
  });

  it("interpolates named placeholders and keeps unknown ones literal", async () => {
    await setLocale("zh-CN");
    expect(t("Saved {count} files", { count: 3 })).toBe("Saved 3 files");
    expect(t("Saved {count} files")).toBe("Saved {count} files");
  });
});

describe("setLocale", () => {
  it("reports the active locale", async () => {
    await setLocale("zh-CN");
    expect(getLocale()).toBe("zh-CN");
    await setLocale("en");
    expect(getLocale()).toBe("en");
  });

  it("notifies subscribers on every change", async () => {
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    await setLocale("zh-CN");
    expect(cb).toHaveBeenCalledTimes(1);
    // Same locale: the loaded pack means there is nothing to repaint.
    await setLocale("zh-CN");
    expect(cb).toHaveBeenCalledTimes(1);
    await setLocale("en");
    expect(cb).toHaveBeenCalledTimes(2);
    unsubscribe();
    await setLocale("zh-CN");
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe("isLocale", () => {
  it("accepts only supported tags", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("zh")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("language mirror", () => {
  it("defaults to auto when nothing is stored", () => {
    expect(readLanguageMirror()).toBe("auto");
  });

  it("round-trips a stored preference", () => {
    writeLanguageMirror("zh-CN");
    expect(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe("zh-CN");
    expect(readLanguageMirror()).toBe("zh-CN");
  });

  it("ignores unsupported stored values", () => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "klingon");
    expect(readLanguageMirror()).toBe("auto");
  });

  it("resolves auto from the OS tag and keeps explicit choices", () => {
    expect(resolveLocale("auto", "zh-Hans-CN")).toBe("zh-CN");
    expect(resolveLocale("auto", "fr-FR")).toBe("en");
    expect(resolveLocale("en", "zh-CN")).toBe("en");
    expect(resolveLocale("zh-CN", "en-US")).toBe("zh-CN");
  });

  it("coerces unknown values to auto", () => {
    expect(coerceUiLanguage("ru")).toBe("auto");
    expect(coerceUiLanguage(null)).toBe("auto");
  });
});
