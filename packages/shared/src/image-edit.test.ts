import { describe, expect, it } from "vitest";

import {
  type OUTPAINT_ANCHORS,
  imageEditSchema,
  outpaintFrame,
} from "./image-edit.js";
import { createImageJobRequestSchema } from "./job-contracts.js";

describe("outpaintFrame", () => {
  it("puts the picture at each anchor of the tightest frame", () => {
    const at = (anchor: (typeof OUTPAINT_ANCHORS)[number]) => {
      const frame = outpaintFrame({ width: 100, height: 100 }, 2, 1, anchor);
      return frame && [frame.left, frame.top];
    };
    expect(at("left")).toEqual([0, 0]);
    expect(at("center")).toEqual([50, 0]);
    expect(at("right")).toEqual([100, 0]);
    const tall = outpaintFrame({ width: 100, height: 100 }, 0.5, 1, "bottom");
    expect(tall).toEqual({
      width: 100,
      height: 200,
      left: 0,
      top: 100,
      sourceWidth: 100,
      sourceHeight: 100,
    });
  });

  it("zooms out by scale and fits the long edge", () => {
    expect(
      outpaintFrame({ width: 1000, height: 500 }, 2, 2, "top-left", 1000),
    ).toEqual({
      width: 1000,
      height: 500,
      left: 0,
      top: 0,
      sourceWidth: 500,
      sourceHeight: 250,
    });
  });

  it("returns null when nothing would be added or the input is bad", () => {
    expect(outpaintFrame({ width: 300, height: 200 }, 1.5, 1, "center")).toBeNull();
    expect(outpaintFrame({ width: 0, height: 200 }, 1.5, 2, "center")).toBeNull();
    expect(outpaintFrame({ width: 300, height: 200 }, Number.NaN, 2, "center")).toBeNull();
  });
});

describe("edit requests", () => {
  it("accepts 局部重绘 and 扩图 on a job request", () => {
    const base = { prompt: "x", input_images: ["https://example.test/a.png"] };
    expect(
      createImageJobRequestSchema.parse({
        ...base,
        edit: { mode: "inpaint", mask: "https://example.test/m.png" },
      }).edit,
    ).toEqual({ mode: "inpaint", mask: "https://example.test/m.png" });
    expect(
      imageEditSchema.safeParse({ mode: "outpaint", scale: 0.5, anchor: "center" })
        .success,
    ).toBe(false);
    expect(
      imageEditSchema.safeParse({ mode: "outpaint", scale: 1.2, anchor: "middle" })
        .success,
    ).toBe(false);
  });
});
