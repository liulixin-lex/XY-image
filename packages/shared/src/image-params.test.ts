import { describe, expect, it } from "vitest";

import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_QUALITIES,
  type ImageCapabilities,
  aspectRatioValue,
  fitsShape,
  normalizeImageParams,
  resolveImageParams,
} from "./image-params.js";
import { createImageJobRequestSchema } from "./job-contracts.js";

describe("image params", () => {
  it("reads the old single quality field as what it used to send", () => {
    expect(normalizeImageParams({ quality: "standard" })).toEqual({
      resolution: "1K",
      quality: "low",
    });
    expect(normalizeImageParams({ quality: "hd" })).toEqual({
      resolution: "2K",
      quality: "medium",
    });
    expect(normalizeImageParams({ quality: "ultra" })).toEqual({
      resolution: "4K",
      quality: "auto",
    });
  });

  it("keeps new values and defaults unknown ones", () => {
    expect(normalizeImageParams({ resolution: "4K", quality: "high" })).toEqual(
      {
        resolution: "4K",
        quality: "high",
      },
    );
    expect(normalizeImageParams({ resolution: "8K", quality: "max" })).toEqual({
      resolution: "2K",
      quality: "auto",
    });
    expect(normalizeImageParams({})).toEqual({
      resolution: "2K",
      quality: "auto",
    });
    // A new request with an old quality value: the size wins, quality defaults.
    expect(normalizeImageParams({ resolution: "1K", quality: "hd" })).toEqual({
      resolution: "1K",
      quality: "auto",
    });
  });

  it("accepts new and legacy request shapes", () => {
    expect(
      createImageJobRequestSchema.parse({
        prompt: "x",
        resolution: "4K",
        quality: "high",
        aspect_ratio: "21:9",
      }),
    ).toMatchObject({ resolution: "4K", quality: "high" });
    expect(
      createImageJobRequestSchema.parse({ prompt: "x", quality: "hd" }),
    ).toMatchObject({ quality: "hd" });
    expect(() =>
      createImageJobRequestSchema.parse({ prompt: "x", resolution: "8K" }),
    ).toThrow();
  });

  it("parses ratios", () => {
    expect(aspectRatioValue("16:9")).toBeCloseTo(16 / 9);
    expect(aspectRatioValue("19.5:9")).toBeCloseTo(19.5 / 9);
    expect(aspectRatioValue("wide")).toBeNull();
    expect(aspectRatioValue("0:1")).toBeNull();
  });

  // gpt-image-2-like: every size, but 1K cannot be wider than 1.6:1.
  const openai: ImageCapabilities = {
    resolutions: ["1K", "2K", "4K"],
    qualities: [...IMAGE_QUALITIES],
    aspectRatios: [...IMAGE_ASPECT_RATIOS],
    maxRatio: { "1K": 1.6 },
  };
  // grok-like: no 4K, no 4:5, no 高.
  const grok: ImageCapabilities = {
    resolutions: ["1K", "2K"],
    qualities: ["auto", "low", "medium"],
    aspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "21:9"],
  };

  it("checks a shape against a size's ratio limit", () => {
    expect(fitsShape(openai, "1K", "3:2")).toBe(true);
    expect(fitsShape(openai, "1K", "16:9")).toBe(false);
    expect(fitsShape(openai, "1K", "9:16")).toBe(false);
    expect(fitsShape(openai, "2K", "21:9")).toBe(true);
    expect(fitsShape(grok, "1K", "21:9")).toBe(true);
  });

  it("keeps what the model supports and logs nothing", () => {
    expect(
      resolveImageParams(openai, {
        resolution: "4K",
        quality: "high",
        aspectRatio: "4:5",
      }),
    ).toEqual({
      resolution: "4K",
      quality: "high",
      aspectRatio: "4:5",
      adjusted: [],
    });
  });

  it("moves each unsupported value to the closest one, ratio first", () => {
    expect(
      resolveImageParams(grok, {
        resolution: "4K",
        quality: "high",
        aspectRatio: "4:5",
      }),
    ).toEqual({
      resolution: "2K",
      quality: "auto",
      aspectRatio: "3:4",
      adjusted: ["aspect 4:5→3:4", "resolution 4K→2K", "quality high→auto"],
    });
  });

  it("raises the size rather than squashing a shape it cannot make", () => {
    expect(
      resolveImageParams(openai, { resolution: "1K", aspectRatio: "9:16" }),
    ).toMatchObject({ resolution: "2K", aspectRatio: "9:16" });
    // Already big enough: untouched.
    expect(
      resolveImageParams(openai, { resolution: "4K", aspectRatio: "21:9" }),
    ).toMatchObject({ resolution: "4K", adjusted: [] });
    // Nothing larger fits: keep the size, the provider clamps.
    expect(
      resolveImageParams(
        { ...openai, resolutions: ["1K"] },
        { resolution: "1K", aspectRatio: "16:9" },
      ),
    ).toMatchObject({ resolution: "1K" });
  });

  it("fills defaults without reporting them as changes", () => {
    expect(resolveImageParams(openai, {})).toEqual({
      resolution: "2K",
      quality: "auto",
      aspectRatio: "1:1",
      adjusted: [],
    });
    // A model whose sizes start above the default.
    expect(
      resolveImageParams(
        { ...openai, resolutions: ["4K"] },
        { resolution: "2K" },
      ),
    ).toMatchObject({ resolution: "4K", adjusted: ["resolution 2K→4K"] });
  });
});
