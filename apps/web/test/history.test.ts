import { afterEach, describe, expect, it } from "vitest";

import { dayLabel, groupByDay } from "../src/lib/history";
import { savePendingDraft, takePendingDraft } from "../src/lib/pending-prompt";

describe("最近生成 days (第 56 条)", () => {
  const now = new Date(2026, 9, 12, 15, 0);
  it("names today, yesterday, then dates (with the year when it differs)", () => {
    expect(dayLabel(new Date(2026, 9, 12, 0, 5).toISOString(), now)).toBe("今天");
    expect(dayLabel(new Date(2026, 9, 11, 23, 59).toISOString(), now)).toBe("昨天");
    expect(dayLabel(new Date(2026, 9, 8, 9).toISOString(), now)).toBe("10月8日 周四");
    expect(dayLabel(new Date(2025, 11, 31, 9).toISOString(), now)).toBe("2025年12月31日 周三");
  });

  it("groups consecutive pictures of a day", () => {
    const at = (d: number, h: number) => ({ createdAt: new Date(2026, 9, d, h).toISOString() });
    const groups = groupByDay([at(12, 9), at(12, 1), at(11, 20), at(9, 8)], now);
    expect(groups.map((g) => [g.label, g.jobs.length])).toEqual([
      ["今天", 2],
      ["昨天", 1],
      ["10月9日 周五", 1],
    ]);
  });
});

describe("handing a picture to the studio", () => {
  afterEach(() => sessionStorage.clear());
  it("keeps model, key, 质量 and a reference; never more than once", () => {
    savePendingDraft({
      prompt: "海边灯塔",
      aspectRatio: "3:4",
      resolution: "4K",
      quality: "high",
      model: "nano-banana-pro",
      keyId: 10,
    });
    expect(takePendingDraft()).toEqual({
      prompt: "海边灯塔",
      aspectRatio: "3:4",
      resolution: "4K",
      quality: "high",
      model: "nano-banana-pro",
      keyId: 10,
    });
    expect(takePendingDraft()).toBeNull();
    savePendingDraft({ prompt: "", reference: { url: "https://x.test/a.png", assetId: "a1", name: "之前的作品" } });
    expect(takePendingDraft()).toEqual({
      prompt: "",
      reference: { url: "https://x.test/a.png", assetId: "a1", name: "之前的作品" },
    });
  });
});
