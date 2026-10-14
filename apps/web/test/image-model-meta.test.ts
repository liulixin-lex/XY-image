import { describe, expect, it } from "vitest";

import {
  defaultFormatLabel,
  describeImageParams,
  modelCapabilities,
  modelNote,
  qualityHint,
  qualityOptions,
  resolutionUnavailable,
} from "@/lib/image-model-meta";

describe("image model parameters", () => {
  it("prefers the server's capabilities, then older servers' maxQuality, then hints", () => {
    expect(
      modelCapabilities({
        id: "seedream-5",
        displayName: "Seedream 5",
        description: "",
        provider: "xy2api-openai",
        resolutions: ["1K", "2K"],
        qualities: [],
        aspectRatios: ["1:1"],
        supportsEdit: false,
        maxInputImages: 4,
      }),
    ).toEqual({
      resolutions: ["1K", "2K"],
      qualities: [],
      aspectRatios: ["1:1"],
      maxRatio: {},
      maxInputImages: 0,
      // 第 66 条: an unknown model is offered none of the vendor options.
      autoQuality: null,
      backgrounds: [],
      outputFormats: [],
      moderations: [],
      outputDefaults: null,
    });
    expect(
      modelCapabilities({
        id: "gpt-image-2",
        displayName: "GPT Image 2",
        description: "",
        provider: "xy2api-openai",
        maxQuality: "standard",
      }).resolutions,
    ).toEqual(["1K"]);
    expect(
      modelCapabilities({
        id: "grok-imagine-image-2.0",
        displayName: "Grok Imagine 2.0",
        description: "",
        provider: "xy2api-xai",
      }),
    ).toMatchObject({
      resolutions: ["1K", "2K"],
      qualities: ["auto", "low", "medium"],
      maxInputImages: 0,
    });
  });

  it("says why a 画质 is off for the model and ratio", () => {
    const gpt = modelCapabilities({
      id: "gpt-image-2",
      displayName: "GPT Image 2",
      description: "",
      provider: "xy2api-openai",
    });
    // Older servers do not send maxRatio: the hint fills it in.
    expect(gpt.maxRatio).toEqual({ "1K": 1.6 });
    expect(resolutionUnavailable(gpt, "1K", "3:4")).toBeNull();
    expect(resolutionUnavailable(gpt, "1K", "16:9")).toBe("16:9 最小 2K");
    expect(resolutionUnavailable(gpt, "2K", "16:9")).toBeNull();
    const grok = { resolutions: ["1K", "2K"] as const, maxRatio: {} };
    expect(
      resolutionUnavailable(
        { ...grok, resolutions: [...grok.resolutions] },
        "4K",
        "1:1",
      ),
    ).toBe("当前模型最高 2K");
    expect(
      resolutionUnavailable({ resolutions: ["2K", "4K"] }, "1K", "1:1"),
    ).toBe("当前模型不支持 1K");
    // The server's own list wins, including an explicit "no limit".
    expect(
      modelCapabilities({
        id: "gpt-image-2",
        displayName: "GPT Image 2",
        description: "",
        provider: "xy2api-openai",
        maxRatio: {},
      }).maxRatio,
    ).toEqual({});
  });

  it("describes records and models in plain words", () => {
    expect(
      describeImageParams({
        resolution: "4K",
        quality: "high",
        aspectRatio: "3:4",
      }),
    ).toBe("4K · 质量高 · 3:4");
    expect(describeImageParams({ resolution: "2K", quality: "auto" })).toBe(
      "2K",
    );
    expect(
      describeImageParams({
        resolution: "1K",
        quality: null,
        aspectRatio: "1:1",
      }),
    ).toBe("1K · 1:1");
    expect(modelNote("gpt-image-2.5-sunburst")).toBe("效果优先");
    expect(modelNote("gpt-image-2")).toBeNull();
    expect(modelNote("not-in-catalog")).toBeNull();
  });

  it("offers each model its own 质量 levels and says what 自动 means (第 66 条)", () => {
    const caps = (id: string) =>
      modelCapabilities({ id, displayName: id, description: "", provider: "xy2api" });
    expect(qualityOptions(caps("gpt-image-2.5-sunburst"))).toEqual([
      "auto",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(qualityOptions(caps("gpt-image-2"))).toEqual(["auto", "low", "medium", "high"]);
    expect(qualityOptions(caps("grok-imagine-image"))).toEqual(["auto"]);
    expect(qualityHint("auto", caps("nano-banana-2.1"))).toBe("由模型决定，相当于中");
    expect(qualityHint("auto", caps("gpt-image-2"))).toBe("由模型按内容决定");
    expect(qualityHint("max", caps("gpt-image-2.5-sunburst"))).toBe("细节最多，最慢");
    // Fallback hints when the server does not send the new fields.
    expect(caps("gpt-image-2.5-flare")).toMatchObject({
      backgrounds: ["auto", "opaque", "transparent"],
      outputFormats: ["jpeg", "png", "webp"],
      moderations: ["auto", "low"],
    });
    expect(caps("gpt-image-2").backgrounds).toEqual([]);
    expect(caps("nano-banana-pro").outputFormats).toEqual([]);
  });

  it("names the site's default format and shows the output choices in records", () => {
    expect(defaultFormatLabel({ outputDefaults: null })).toBe("默认");
    expect(defaultFormatLabel({ outputDefaults: { format: "jpeg", compression: 90 } })).toBe(
      "默认 · JPEG 90",
    );
    expect(defaultFormatLabel({ outputDefaults: { format: "png", compression: 90 } })).toBe(
      "默认 · PNG",
    );
    expect(
      describeImageParams({
        resolution: "2K",
        quality: "max",
        aspectRatio: "1:1",
        background: "transparent",
        outputFormat: "png",
      }),
    ).toBe("2K · 质量最高 · 1:1 · 透明背景 · PNG");
  });
});
