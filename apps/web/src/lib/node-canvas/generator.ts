/**
 * Generator nodes: settings stored on the element.
 *
 * A `generator` element keeps its settings and its latest run in
 * `customData.generator`. The run lists each picture's job and the canvas
 * slot it goes to, so a reloaded page shows the pictures still on their way
 * (the worker places finished ones in their slot, lib/node-canvas/layout.ts).
 *
 * Canvases made before the node canvas have `image-generator` placeholders
 * (rectangles with `customData.type`); they open as generator nodes.
 */
import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_BATCH_MAX,
  type ImageQuality,
  type ImageResolution,
  normalizeImageParams,
} from "@loomic/shared";

import { bumpElement, readNumber } from "./element";
import type { SceneElement } from "./types";

export type GeneratorJob = {
  jobId: string;
  slot: { x: number; y: number; width: number; height: number };
};

export type GeneratorRun = {
  batchId: string | null;
  /** In slot order. */
  jobs: GeneratorJob[];
  startedAt: number;
};

export type GeneratorConfig = {
  /** "" = the account's default image model. */
  model: string;
  aspectRatio: string;
  resolution: ImageResolution;
  quality: ImageQuality;
  count: number;
  /** The node's own description, after the text of connected prompt cards. */
  prompt: string;
  run?: GeneratorRun;
};

export const GENERATOR_WIDTH = 296;
export const GENERATOR_MIN_HEIGHT = 320;

export const GENERATOR_DEFAULTS: GeneratorConfig = {
  model: "",
  aspectRatio: "1:1",
  resolution: "2K",
  quality: "auto",
  count: 1,
  prompt: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clampCount(value: unknown): number {
  const count = Math.round(readNumber(value, 1));
  return Math.min(IMAGE_BATCH_MAX, Math.max(1, count));
}

function readSlot(value: unknown): GeneratorJob["slot"] | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  if (
    ![x, y, width, height].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    )
  )
    return null;
  return { x, y, width, height } as GeneratorJob["slot"];
}

function readRun(value: unknown): GeneratorRun | undefined {
  if (!isRecord(value) || !Array.isArray(value.jobs)) return undefined;
  const jobs = value.jobs.flatMap((job): GeneratorJob[] => {
    if (!isRecord(job) || typeof job.jobId !== "string") return [];
    const slot = readSlot(job.slot);
    return slot ? [{ jobId: job.jobId, slot }] : [];
  });
  if (jobs.length === 0) return undefined;
  return {
    batchId: typeof value.batchId === "string" ? value.batchId : null,
    jobs,
    startedAt: readNumber(value.startedAt, 0),
  };
}

/** The settings of a generator element; anything missing or invalid is the default. */
export function readGenerator(el: SceneElement): GeneratorConfig {
  const raw = isRecord(el.customData?.generator) ? el.customData.generator : {};
  const { resolution, quality } = normalizeImageParams(raw, GENERATOR_DEFAULTS);
  const aspectRatio =
    typeof raw.aspectRatio === "string" &&
    (IMAGE_ASPECT_RATIOS as readonly string[]).includes(raw.aspectRatio)
      ? raw.aspectRatio
      : GENERATOR_DEFAULTS.aspectRatio;
  const run = readRun(raw.run);
  return {
    model: typeof raw.model === "string" ? raw.model : "",
    aspectRatio,
    resolution,
    quality,
    count: clampCount(raw.count),
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    ...(run ? { run } : {}),
  };
}

/** `el` with changed generator settings (next version). */
export function updateGenerator(
  el: SceneElement,
  changes: Partial<Omit<GeneratorConfig, "run">> & {
    run?: GeneratorRun | undefined;
  },
): SceneElement {
  const { run, ...settings } = { ...readGenerator(el), ...changes };
  const next: GeneratorConfig = {
    ...settings,
    count: clampCount(settings.count),
    // `run: undefined` in changes clears the run.
    ...(run ? { run } : {}),
  };
  return bumpElement(el, {
    customData: { ...el.customData, generator: next },
  });
}

/** An `image-generator` placeholder from before the node canvas. */
export function isLegacyGenerator(el: SceneElement): boolean {
  return el.type === "rectangle" && el.customData?.type === "image-generator";
}

/**
 * The generator element for a legacy placeholder: same id and position, its
 * prompt and settings (old `quality` values read as 画质), next version.
 * Its stale status and error are dropped.
 */
export function migrateLegacyGenerator(el: SceneElement): SceneElement {
  const legacy = el.customData ?? {};
  const { resolution, quality } = normalizeImageParams(
    legacy,
    GENERATOR_DEFAULTS,
  );
  const generator: GeneratorConfig = {
    model: typeof legacy.model === "string" ? legacy.model : "",
    aspectRatio:
      typeof legacy.aspectRatio === "string" &&
      (IMAGE_ASPECT_RATIOS as readonly string[]).includes(legacy.aspectRatio)
        ? legacy.aspectRatio
        : GENERATOR_DEFAULTS.aspectRatio,
    resolution,
    quality,
    count: 1,
    prompt: typeof legacy.prompt === "string" ? legacy.prompt : "",
  };
  // The settings move into `generator`; other keys (inputImages) stay.
  const {
    type: _type,
    status: _status,
    errorMessage: _error,
    prompt: _prompt,
    model: _model,
    aspectRatio: _ratio,
    resolution: _resolution,
    quality: _quality,
    ...rest
  } = legacy;
  return bumpElement(el, {
    type: "generator",
    width: GENERATOR_WIDTH,
    height: Math.max(GENERATOR_MIN_HEIGHT, readNumber(el.height, 0)),
    customData: { ...rest, generator },
  });
}
