import { describe, expect, it, vi } from "vitest";
import { checkMaskEdit, imagePayloadSchema } from "./billing-guard.js";
import {
  findImageModel,
  loadImageCatalog,
  matchImageModels,
  resolveImageParams,
  supportsMaskEdit,
} from "./catalog.js";
import { BillingGuardError } from "./errors.js";

describe("image catalog", () => {
  const catalog = loadImageCatalog();
  it("uses the actual alias advertised by the gateway", () => {
    expect(
      matchImageModels(catalog, "gemini", [
        "gemini-3-pro-image-preview",
        "gpt-4.1",
      ]),
    ).toEqual(["gemini-3-pro-image-preview"]);
    expect(
      findImageModel(catalog, "gemini-3-pro-image-preview")?.protocol,
    ).toBe("gemini");
  });
  it("falls back by platform only when no image model is advertised", () => {
    expect(matchImageModels(catalog, "grok", ["gpt-4.1"])).toEqual([
      "grok-imagine-image-2.0",
    ]);
    expect(
      matchImageModels(catalog, "openai", ["gpt-image-2.5-flare", "gpt-5.5"]),
    ).toEqual(["gpt-image-2.5-flare"]);
    expect(matchImageModels(catalog, "claude", [])).toEqual([]);
  });
  it("rejects malformed catalogs without echoing their content", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => loadImageCatalog("synthetic-sensitive-text")).toThrow(
      "Invalid LOOMIC_IMAGE_MODELS",
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("synthetic");
    expect(() =>
      loadImageCatalog(
        JSON.stringify([
          { ...entry("a"), id: "dup" },
          { ...entry("b"), id: "dup" },
        ]),
      ),
    ).toThrow("Invalid LOOMIC_IMAGE_MODELS");
  });
  it("lists the primary models with their vendors' parameters", () => {
    const pick = (id: string) => findImageModel(catalog, id);
    expect(catalog.map((model) => model.id)).toEqual([
      "gpt-image-2",
      "gpt-image-2.5-sunburst",
      "gpt-image-2.5-flare",
      "nano-banana-2.1",
      "nano-banana-pro",
      "grok-imagine-image-2.0",
      "gemini-3.1-flash-image",
    ]);
    expect(pick("gpt-image-2.5-flare")).toMatchObject({
      vendor: "openai",
      resolutions: ["1K", "2K", "4K"],
      qualities: ["auto", "low", "medium", "high"],
      sizing: "flexible",
    });
    expect(pick("gemini-3-pro-image-preview")).toMatchObject({
      vendor: "google",
      resolutions: ["1K", "2K", "4K"],
      qualities: [],
    });
    expect(pick("nano-banana-2.1")?.vendorQuality).toEqual({
      low: "minimal",
      medium: "medium",
      high: "high",
    });
    expect(pick("grok-imagine-image-2.0")).toMatchObject({
      vendor: "xai",
      resolutions: ["1K", "2K"],
      qualities: ["auto", "low", "medium"],
      supportsEdit: false,
    });
  });
  it("adds a model from LOOMIC_IMAGE_MODELS with protocol defaults", () => {
    const [model] = loadImageCatalog(
      JSON.stringify([{ ...entry("seedream-5"), protocol: "openai-images" }]),
    );
    expect(model).toMatchObject({
      vendor: "openai",
      resolutions: ["1K", "2K", "4K"],
      qualities: ["auto", "low", "medium", "high"],
      aspectRatios: expect.arrayContaining(["1:1", "21:9"]),
    });
    // Catalog v1 entries keep working: maxQuality hd meant 1K and 2K.
    const [legacy] = loadImageCatalog(
      JSON.stringify([
        { ...entry("gpt-image-1.5"), maxQuality: "hd", sizing: "fixed" },
      ]),
    );
    expect(legacy?.resolutions).toEqual(["1K", "2K"]);
    expect(legacy).not.toHaveProperty("maxQuality");
  });
  it("moves unsupported parameters to the closest supported ones", () => {
    const grok = findImageModel(catalog, "grok-imagine-image-2.0");
    if (!grok) throw new Error("missing");
    expect(
      resolveImageParams(grok, {
        resolution: "4K",
        quality: "high",
        aspectRatio: "5:4",
      }),
    ).toEqual({
      resolution: "2K",
      quality: "auto",
      aspectRatio: "4:3",
      adjusted: ["aspect 5:4→4:3", "resolution 4K→2K", "quality high→auto"],
    });
    expect(resolveImageParams(grok, {})).toEqual({
      resolution: "2K",
      quality: "auto",
      aspectRatio: "1:1",
      adjusted: [],
    });
    // OpenAI cannot make 16:9 at 1K (billed by long edge, minimum pixels):
    // it moves up to 2K rather than changing the picture's shape.
    const gpt = findImageModel(catalog, "gpt-image-2");
    if (!gpt) throw new Error("missing");
    expect(
      resolveImageParams(gpt, { resolution: "1K", aspectRatio: "16:9" }),
    ).toMatchObject({
      resolution: "2K",
      aspectRatio: "16:9",
      adjusted: ["resolution 1K→2K"],
    });
    expect(
      resolveImageParams(gpt, { resolution: "1K", aspectRatio: "2:3" }),
    ).toMatchObject({ resolution: "1K", adjusted: [] });
    expect(
      resolveImageParams(
        {
          resolutions: ["1K"],
          qualities: [],
          aspectRatios: ["1:1"],
          maxRatio: {},
        },
        { resolution: "2K", aspectRatio: "nonsense" },
      ),
    ).toMatchObject({ resolution: "1K", aspectRatio: "1:1" });
  });
});

function entry(id: string) {
  return {
    id,
    displayName: id,
    description: "",
    protocol: "openai-images",
    platforms: ["openai"],
    supportsEdit: false,
    maxInputImages: 0,
  };
}

describe("局部重绘 / 扩图 support", () => {
  const catalog = loadImageCatalog();
  const model = (id: string) => {
    const found = findImageModel(catalog, id);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };
  it("is on for OpenAI and Gemini editors and off for Grok", () => {
    expect(supportsMaskEdit(model("gpt-image-2"))).toBe(true);
    expect(supportsMaskEdit(model("nano-banana-pro"))).toBe(true);
    expect(supportsMaskEdit(model("grok-imagine-image-2.0"))).toBe(false);
  });
  it("needs room for two images on Gemini (source + highlighted copy)", () => {
    expect(
      supportsMaskEdit({ ...model("nano-banana-pro"), maxInputImages: 1 }),
    ).toBe(false);
    expect(
      supportsMaskEdit({ ...model("gpt-image-2"), supportsEdit: false }),
    ).toBe(false);
  });
  it("refuses an unsupported model or anything but one source", () => {
    expect(() => checkMaskEdit(model("grok-imagine-image-2.0"), 1)).toThrow(
      "不支持局部重绘和扩图",
    );
    expect(() => checkMaskEdit(model("gpt-image-2"), 2)).toThrow(
      "一次只改一张图",
    );
    expect(() => checkMaskEdit(model("gpt-image-2"), 0)).toThrow(
      BillingGuardError,
    );
    expect(() => checkMaskEdit(model("gpt-image-2"), 1)).not.toThrow();
  });
  it("stores the edit with the job payload and rejects a bad one", () => {
    const base = {
      prompt: "x",
      model: "gpt-image-2",
      resolution: "2K",
      quality: "auto",
      input_images: ["https://example.test/a.png"],
    };
    expect(
      imagePayloadSchema.parse({
        ...base,
        edit: { mode: "outpaint", scale: 1.5, anchor: "top-left" },
      }).edit,
    ).toEqual({ mode: "outpaint", scale: 1.5, anchor: "top-left" });
    expect(
      imagePayloadSchema.safeParse({
        ...base,
        edit: { mode: "outpaint", scale: 3, anchor: "center" },
      }).success,
    ).toBe(false);
    expect(
      imagePayloadSchema.safeParse({ ...base, edit: { mode: "inpaint" } })
        .success,
    ).toBe(false);
  });
});
