import {
  IMAGE_RESOLUTIONS,
  type ImageQuality,
  type ImageResolution,
} from "@loomic/shared";

import { type ImageModel, findImageModel } from "./catalog.js";

/** A bad PREFLIGHT_* filter; its message holds only model ids and sizes. */
export class PreflightPlanError extends Error {
  override name = "PreflightPlanError";
}

export type PreflightImageCall = {
  model: string;
  resolution: ImageResolution;
  quality: ImageQuality;
};

export type PreflightPlan = {
  calls: PreflightImageCall[];
  /** Requested combinations the model does not offer (not sent, not paid). */
  skipped: { model: string; resolution: ImageResolution }[];
};

/** "a, b,,c" → ["a", "b", "c"]; empty or unset → null (no filter). */
function list(value: string | undefined): string[] | null {
  const items = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : null;
}

/**
 * Which paid image calls the preflight makes: one per model the key can use
 * and per 画质 that model lists, at its cheapest 质量 (`low`, else `auto`).
 *
 * `PREFLIGHT_MODELS` and `PREFLIGHT_RESOLUTIONS` (comma separated) narrow it
 * for a cheap smoke test, e.g. `PREFLIGHT_RESOLUTIONS=1K`. A filter value that
 * matches nothing is an error, so a typo never quietly turns into a full,
 * more expensive run (or an empty one that looks like a pass).
 */
export function planPreflight(
  catalog: ImageModel[],
  discovered: string[],
  filters: { models?: string | undefined; resolutions?: string | undefined },
): PreflightPlan {
  const wantedModels = list(filters.models);
  const wantedResolutions = list(filters.resolutions)?.map((value) =>
    value.toUpperCase(),
  );

  const badResolution = wantedResolutions?.find(
    (value) => !(IMAGE_RESOLUTIONS as readonly string[]).includes(value),
  );
  if (badResolution)
    throw new PreflightPlanError(
      `PREFLIGHT_RESOLUTIONS: unknown value ${badResolution}; use ${IMAGE_RESOLUTIONS.join(",")}`,
    );
  const missing = wantedModels?.filter((id) => !discovered.includes(id));
  if (missing?.length)
    throw new PreflightPlanError(
      `PREFLIGHT_MODELS: not available to this key: ${missing.join(",")}; available: ${discovered.join(",")}`,
    );

  const calls: PreflightImageCall[] = [];
  const skipped: PreflightPlan["skipped"] = [];
  for (const model of wantedModels ?? discovered) {
    const entry = findImageModel(catalog, model);
    const offered = entry?.resolutions ?? ["1K"];
    const quality: ImageQuality = entry?.qualities.includes("low")
      ? "low"
      : "auto";
    for (const resolution of (wantedResolutions as
      | ImageResolution[]
      | undefined) ?? offered) {
      if (offered.includes(resolution))
        calls.push({ model, resolution, quality });
      else skipped.push({ model, resolution });
    }
  }
  if (!calls.length)
    throw new PreflightPlanError(
      "Preflight plan is empty: no selected model offers the selected 画质",
    );
  return { calls, skipped };
}
