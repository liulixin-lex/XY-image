import { describe, expect, it } from "vitest";

import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_QUALITIES,
  type ImageCapabilities,
  aspectRatioValue,
  closestQuality,
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
    expect(normalizeImageParams({ resolution: "8K", quality: "extreme" })).toEqual({
      resolution: "2K",
      quality: "auto",
    });
    // GPT Image 2.5's top levels are real values (第 66 条).
    expect(normalizeImageParams({ resolution: "4K", quality: "max" })).toEqual({
      resolution: "4K",
      quality: "max",
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
      background: "auto",
      outputFormat: null,
      outputCompression: null,
      moderation: "auto",
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
    ).toMatchObject({
      resolution: "2K",
      // Grok stops at medium: 高 runs at its highest level, not at auto.
      quality: "medium",
      aspectRatio: "3:4",
      adjusted: ["aspect 4:5→3:4", "resolution 4K→2K", "quality high→medium"],
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
      background: "auto",
      outputFormat: null,
      outputCompression: null,
      moderation: "auto",
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

  it("moves 质量 to the nearest level the model has (第 66 条)", () => {
    const sunburst = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
    const gpt2 = ["auto", "low", "medium", "high"] as const;
    const nano2 = ["auto", "low", "high"] as const;
    expect(closestQuality(sunburst, "max")).toBe("max");
    expect(closestQuality(gpt2, "max")).toBe("high");
    expect(closestQuality(gpt2, "xhigh")).toBe("high");
    expect(closestQuality(nano2, "medium")).toBe("low");
    expect(closestQuality(["auto", "high"], "low")).toBe("high");
    expect(closestQuality([], "high")).toBe("auto");
    expect(closestQuality(gpt2, "auto")).toBe("auto");
    expect(closestQuality(gpt2, undefined)).toBe("auto");
  });

  it("resolves the OpenAI output options (第 66 条)", () => {
    const sunburst = {
      ...openai,
      qualities: ["auto", "low", "medium", "high", "xhigh", "max"] as const,
      backgrounds: ["auto", "opaque", "transparent"] as const,
      outputFormats: ["jpeg", "png", "webp"] as const,
      moderations: ["auto", "low"] as const,
    };
    expect(
      resolveImageParams(sunburst, {
        quality: "xhigh",
        outputFormat: "webp",
        outputCompression: 72.4,
        background: "opaque",
        moderation: "low",
      }),
    ).toMatchObject({
      quality: "xhigh",
      outputFormat: "webp",
      outputCompression: 72,
      background: "opaque",
      moderation: "low",
      adjusted: [],
    });
    // Transparent needs png / webp: jpeg and the default become png.
    expect(
      resolveImageParams(sunburst, { background: "transparent", outputFormat: "jpeg" }),
    ).toMatchObject({ background: "transparent", outputFormat: "png", outputCompression: null });
    expect(
      resolveImageParams(sunburst, { background: "transparent" }),
    ).toMatchObject({ outputFormat: "png" });
    expect(
      resolveImageParams(sunburst, { background: "transparent", outputFormat: "webp" }),
    ).toMatchObject({ outputFormat: "webp" });
    // Compression only means something for jpeg / webp, and stays in 0–100.
    expect(
      resolveImageParams(sunburst, { outputFormat: "png", outputCompression: 50 }),
    ).toMatchObject({ outputCompression: null });
    expect(
      resolveImageParams(sunburst, { outputFormat: "jpeg", outputCompression: 140 }),
    ).toMatchObject({ outputCompression: 100 });
    // A model without these options keeps the defaults and says so.
    expect(
      resolveImageParams(grok, {
        background: "transparent",
        outputFormat: "png",
        moderation: "low",
      }),
    ).toMatchObject({
      background: "auto",
      outputFormat: null,
      moderation: "auto",
      adjusted: ["format png→default", "background transparent→auto", "moderation low→auto"],
    });
  });
});
