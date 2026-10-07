import { describe, expect, it } from "vitest";
import {
  findImageModel,
  loadImageCatalog,
  matchImageModels,
} from "./catalog.js";

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
      "grok-imagine-image",
    ]);
    expect(matchImageModels(catalog, "openai", ["gpt-image-1.5"])).toEqual([
      "gpt-image-1.5",
    ]);
    expect(matchImageModels(catalog, "claude", [])).toEqual([]);
  });
  it("rejects malformed catalogs without echoing their content", () => {
    expect(() => loadImageCatalog("synthetic-sensitive-text")).toThrow(
      "Invalid LOOMIC_IMAGE_MODELS",
    );
  });
});
