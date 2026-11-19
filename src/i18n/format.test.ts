import { afterEach, describe, expect, it } from "vitest";
import {
  formatCompactDateTime,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  localeTag,
} from "./format";
import { setLocale } from "./index";

// 2026-11-19T01:15:00Z; assertions stay timezone-agnostic by checking the
// locale-specific shape (year/month markers) rather than an exact string.
const SECONDS = 1_795_050_900;

afterEach(async () => {
  await setLocale("en");
});

describe("localeTag", () => {
  it("follows the UI language", async () => {
    expect(localeTag()).toBe("en-US");
    await setLocale("zh-CN");
    expect(localeTag()).toBe("zh-CN");
  });
});

describe("formatDateTime", () => {
  it("renders the year in both languages", async () => {
    expect(formatDateTime(SECONDS)).toContain("2026");
    await setLocale("zh-CN");
    expect(formatDateTime(SECONDS)).toContain("2026");
    expect(formatDateTime(SECONDS)).toContain("年");
  });

  it("renders an empty string for a missing timestamp", () => {
    expect(formatDateTime(0)).toBe("");
  });
});

describe("formatCompactDateTime", () => {
  it("keeps the year only for older dates", async () => {
    const now = new Date(2026, 10, 19, 12, 0, 0);
    const sameYear = formatCompactDateTime(SECONDS, now);
    const older = formatCompactDateTime(SECONDS, new Date(2027, 0, 1));
    expect(sameYear).not.toContain("2026");
    expect(older).toContain("2026");
  });

  it("uses the Chinese month marker under zh-CN", async () => {
    await setLocale("zh-CN");
    expect(formatCompactDateTime(SECONDS, new Date(2026, 10, 19))).toContain(
      "月",
    );
  });
});

describe("formatNumber", () => {
  it("groups digits", async () => {
    expect(formatNumber(1024)).toBe("1,024");
  });
});

describe("formatRelativeTime", () => {
  it("picks the compact English buckets", () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});
