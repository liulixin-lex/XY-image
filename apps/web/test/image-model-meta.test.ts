import { describe, expect, it } from "vitest";

import {
  describeCapabilities,
  describeImageParams,
  modelCapabilities,
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
    expect(
      describeCapabilities({
        resolutions: ["1K", "2K", "4K"],
        qualities: ["auto", "low", "medium", "high"],
      }),
    ).toBe("1K–4K · 质量 4 档");
    expect(describeCapabilities({ resolutions: ["1K"], qualities: [] })).toBe(
      "仅 1K · 质量自动",
    );
  });
});
