import { describe, expect, it } from "vitest";

import { buildCanvasSummaryForContext } from "./inspect-canvas.js";

describe("canvas summary for the design assistant (node canvas)", () => {
  it("describes prompt cards, generator settings and edges", () => {
    const summary = buildCanvasSummaryForContext([
      {
        id: "p1",
        type: "prompt",
        x: 0,
        y: 0,
        width: 240,
        height: 120,
        text: "雨夜的霓虹街道",
      },
      {
        id: "g1",
        type: "generator",
        x: 320,
        y: 0,
        width: 280,
        height: 360,
        customData: {
          generator: {
            model: "gpt-image-2",
            aspectRatio: "16:9",
            resolution: "2K",
            quality: "high",
            count: 4,
            prompt: "",
          },
        },
      },
      {
        id: "e1",
        type: "arrow",
        x: 240,
        y: 60,
        width: 80,
        height: 0,
        startBinding: { elementId: "p1", focus: 0, gap: 4 },
        endBinding: { elementId: "g1", focus: 0, gap: 4 },
      },
      {
        id: "gone",
        type: "generator",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        isDeleted: true,
      },
    ]);

    expect(summary).toContain('prompt#p1 @(0,0) 240x120 "雨夜的霓虹街道"');
    expect(summary).toContain(
      "generator#g1 @(320,0) 280x360 model=gpt-image-2 aspectRatio=16:9 resolution=2K quality=high count=4",
    );
    // An empty generator prompt is left out rather than shown as prompt="".
    expect(summary).not.toContain('prompt=""');
    expect(summary).toContain("arrow#e1 @(240,60) 80x0 p1→g1");
    expect(summary).not.toContain("gone");
  });

  it("leaves a free arrow without endpoints", () => {
    const summary = buildCanvasSummaryForContext([
      {
        id: "a1",
        type: "arrow",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        startBinding: null,
        endBinding: null,
      },
    ]);
    expect(summary).not.toContain("→g");
    expect(summary).toMatch(/arrow#a1 @\(0,0\) 10x10/);
  });
});
