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
    // 第 69 条: edges as one compact line, not one element each.
    expect(summary).toContain("edges: p1→g1");
    expect(summary).toContain("Canvas: 2 nodes, 1 edges");
    expect(summary).not.toContain("gone");
  });

  it("shows how much of a generator's latest run is on the canvas", () => {
    const summary = buildCanvasSummaryForContext([
      {
        id: "g1",
        type: "generator",
        x: 0,
        y: 0,
        width: 296,
        height: 440,
        customData: {
          generator: {
            count: 2,
            run: {
              batchId: "b",
              jobs: [
                {
                  jobId: "j1",
                  slot: { x: 400, y: 0, width: 280, height: 280 },
                },
                {
                  jobId: "j2",
                  slot: { x: 704, y: 0, width: 280, height: 280 },
                },
              ],
              startedAt: 1,
            },
          },
        },
      },
      {
        id: "i1",
        type: "image",
        x: 400,
        y: 0,
        width: 280,
        height: 280,
        customData: { jobId: "j1" },
      },
    ]);
    expect(summary).toContain("last_run=1/2 on canvas");
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
