import { describe, expect, it } from "vitest";

import { loadImageCatalog } from "./catalog.js";
import { PreflightPlanError, planPreflight } from "./preflight-plan.js";

const catalog = loadImageCatalog(undefined);
const discovered = [
  "gpt-image-2",
  "grok-imagine-image-2.0",
  "gemini-3-pro-image-preview",
];

describe("preflight plan", () => {
  it("covers every 画质 of every model by default, at the cheapest 质量", () => {
    const plan = planPreflight(catalog, discovered, {});
    expect(plan.calls).toEqual([
      { model: "gpt-image-2", resolution: "1K", quality: "low" },
      { model: "gpt-image-2", resolution: "2K", quality: "low" },
      { model: "gpt-image-2", resolution: "4K", quality: "low" },
      { model: "grok-imagine-image-2.0", resolution: "1K", quality: "low" },
      { model: "grok-imagine-image-2.0", resolution: "2K", quality: "low" },
      // Nano Banana Pro has no 质量 setting; the alias is kept as discovered.
      {
        model: "gemini-3-pro-image-preview",
        resolution: "1K",
        quality: "auto",
      },
      {
        model: "gemini-3-pro-image-preview",
        resolution: "2K",
        quality: "auto",
      },
      {
        model: "gemini-3-pro-image-preview",
        resolution: "4K",
        quality: "auto",
      },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("narrows to chosen models and sizes, skipping sizes a model lacks", () => {
    const plan = planPreflight(catalog, discovered, {
      models: " grok-imagine-image-2.0 , gpt-image-2",
      resolutions: "4k",
    });
    expect(plan.calls).toEqual([
      { model: "gpt-image-2", resolution: "4K", quality: "low" },
    ]);
    expect(plan.skipped).toEqual([
      { model: "grok-imagine-image-2.0", resolution: "4K" },
    ]);
    expect(
      planPreflight(catalog, discovered, { resolutions: "1K" }).calls,
    ).toHaveLength(3);
  });

  it("refuses a filter that matches nothing instead of running more or less", () => {
    expect(() =>
      planPreflight(catalog, discovered, { models: "gpt-image-3" }),
    ).toThrow(PreflightPlanError);
    expect(() =>
      planPreflight(catalog, discovered, { resolutions: "8K" }),
    ).toThrow(/unknown value 8K/);
    expect(() =>
      planPreflight(catalog, discovered, {
        models: "grok-imagine-image-2.0",
        resolutions: "4K",
      }),
    ).toThrow(/plan is empty/);
  });
});
