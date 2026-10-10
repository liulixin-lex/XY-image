/**
 * Client-side hints for image models and the labels of the two image knobs.
 *
 * The server's catalog (apps/server/src/features/xy2api/catalog.ts) is the
 * authority: /api/image-models sends each model's 画质 / 质量 / 比例 and
 * reference limit, and the server moves anything unsupported to the closest
 * supported value. The hints below mirror its default catalog and are only
 * used for older servers that do not send capabilities yet, and for the
 * landing page (no key, no model list). Unknown models get every option and
 * let the server decide.
 */
import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_QUALITIES,
  IMAGE_RESOLUTIONS,
  type ImageAspectRatio,
  type ImageCapabilities,
  type ImageQuality,
  type ImageResolution,
  fitsShape,
} from "@loomic/shared";

import type { ImageModelInfo } from "./server-api";

export type { ImageQuality, ImageResolution };

/** The shared ImageCapabilities, filled in for the pickers. */
export type ImageModelCapabilities = {
  resolutions: ImageResolution[];
  /** Empty when the model has no 质量 setting. */
  qualities: ImageQuality[];
  aspectRatios: string[];
  maxRatio: NonNullable<ImageCapabilities["maxRatio"]>;
  /** 0 when the model takes no reference images. */
  maxInputImages: number;
};

export type ImageModelMeta = Omit<ImageModelCapabilities, "maxRatio"> & {
  maxRatio?: ImageModelCapabilities["maxRatio"];
  id: string;
  aliases: string[];
  displayName: string;
  maker: string;
  description: string;
};

const ALL_RATIOS: string[] = [...IMAGE_ASPECT_RATIOS];
const ALL_QUALITIES: ImageQuality[] = [...IMAGE_QUALITIES];
const ALL_RESOLUTIONS: ImageResolution[] = [...IMAGE_RESOLUTIONS];
/**
 * OpenAI's image sizes at 1K (long edge 1024) cannot be wider than about
 * 1.6:1 and still meet its minimum pixel count, so 16:9, 9:16 and 21:9 need
 * 2K. Mirrors the server catalog's default for the openai-images protocol.
 */
const OPENAI_MAX_RATIO = { "1K": 1.6 };
/** Shared so memoised pickers do not re-run on every render. */
const NO_RATIO_LIMIT: ImageModelCapabilities["maxRatio"] = {};

export const KNOWN_IMAGE_MODELS: ImageModelMeta[] = [
  {
    id: "gpt-image-2",
    aliases: [],
    displayName: "GPT Image 2",
    maker: "OpenAI",
    description: "生成与多图编辑",
    resolutions: ALL_RESOLUTIONS,
    qualities: ALL_QUALITIES,
    aspectRatios: ALL_RATIOS,
    maxRatio: OPENAI_MAX_RATIO,
    maxInputImages: 10,
  },
  {
    id: "gpt-image-2.5-sunburst",
    aliases: [],
    displayName: "GPT Image 2.5 Sunburst",
    maker: "OpenAI",
    description: "GPT Image 2.5，效果优先",
    resolutions: ALL_RESOLUTIONS,
    qualities: ALL_QUALITIES,
    aspectRatios: ALL_RATIOS,
    maxRatio: OPENAI_MAX_RATIO,
    maxInputImages: 10,
  },
  {
    id: "gpt-image-2.5-flare",
    aliases: [],
    displayName: "GPT Image 2.5 Flare",
    maker: "OpenAI",
    description: "GPT Image 2.5，速度优先",
    resolutions: ALL_RESOLUTIONS,
    qualities: ALL_QUALITIES,
    aspectRatios: ALL_RATIOS,
    maxRatio: OPENAI_MAX_RATIO,
    maxInputImages: 10,
  },
  {
    id: "nano-banana-2.1",
    aliases: ["gemini-nano-banana-2.1"],
    displayName: "Nano Banana 2.1",
    maker: "Google",
    description: "生成与多图编辑",
    resolutions: ALL_RESOLUTIONS,
    qualities: ALL_QUALITIES,
    aspectRatios: ALL_RATIOS,
    maxInputImages: 14,
  },
  {
    id: "nano-banana-pro",
    aliases: ["gemini-3-pro-image", "gemini-3-pro-image-preview"],
    displayName: "Nano Banana Pro",
    maker: "Google",
    description: "Gemini 3 Pro 生成与多图编辑",
    resolutions: ALL_RESOLUTIONS,
    qualities: [],
    aspectRatios: ALL_RATIOS,
    maxInputImages: 14,
  },
  {
    id: "grok-imagine-image-2.0",
    aliases: [],
    displayName: "Grok Imagine 2.0",
    maker: "xAI",
    description: "文生图",
    resolutions: ["1K", "2K"],
    qualities: ["auto", "low", "medium"],
    aspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "21:9"],
    maxInputImages: 0,
  },
  {
    id: "gemini-3.1-flash-image",
    aliases: ["gemini-3.1-flash-image-preview", "nano-banana-2"],
    displayName: "Nano Banana 2",
    maker: "Google",
    description: "Gemini 3.1 Flash 生成与多图编辑",
    resolutions: ALL_RESOLUTIONS,
    qualities: ["auto", "low", "high"],
    aspectRatios: ALL_RATIOS,
    maxInputImages: 14,
  },
];

export function findModelMeta(id: string | null | undefined) {
  if (!id) return undefined;
  return KNOWN_IMAGE_MODELS.find(
    (model) => model.id === id || model.aliases.includes(id),
  );
}

/**
 * What the pickers offer for a model: the server's list when it sends one,
 * else the hints above, else everything (the server decides).
 */
export function modelCapabilities(
  model: ImageModelInfo | null | undefined,
): ImageModelCapabilities {
  const meta = findModelMeta(model?.id);
  const resolutions: ImageResolution[] = model?.resolutions?.length
    ? model.resolutions
    : model?.maxQuality
      ? model.maxQuality === "hd"
        ? ["1K", "2K"]
        : ["1K"]
      : (meta?.resolutions ?? ALL_RESOLUTIONS);
  return {
    resolutions,
    qualities: model?.qualities ?? meta?.qualities ?? ALL_QUALITIES,
    aspectRatios: model?.aspectRatios?.length
      ? model.aspectRatios
      : (meta?.aspectRatios ?? ALL_RATIOS),
    maxRatio: model?.maxRatio ?? meta?.maxRatio ?? NO_RATIO_LIMIT,
    maxInputImages:
      model?.supportsEdit === false
        ? 0
        : (model?.maxInputImages ?? meta?.maxInputImages ?? 14),
  };
}

/** Reference-image limit for a model id; unknown models defer to the server. */
export function maxReferenceImages(id: string | null | undefined): number {
  return findModelMeta(id)?.maxInputImages ?? 14;
}

/**
 * Why a 画质 button is off for this model and ratio, or null when it is
 * available. What is actually sent comes from the shared resolveImageParams,
 * the same function the server applies.
 */
export function resolutionUnavailable(
  caps: Pick<ImageCapabilities, "resolutions" | "maxRatio">,
  resolution: ImageResolution,
  aspectRatio: string,
): string | null {
  if (!caps.resolutions.includes(resolution)) {
    const top = caps.resolutions.at(-1);
    return top &&
      IMAGE_RESOLUTIONS.indexOf(resolution) > IMAGE_RESOLUTIONS.indexOf(top)
      ? `当前模型最高 ${top}`
      : `当前模型不支持 ${resolution}`;
  }
  if (fitsShape(caps, resolution, aspectRatio)) return null;
  const smallest = caps.resolutions.find((value) =>
    fitsShape(caps, value, aspectRatio),
  );
  return smallest ? `${aspectRatio} 最小 ${smallest}` : null;
}

/** "1K–4K · 质量 4 档" — a model's range, for pickers and settings. */
export function describeCapabilities(
  caps: Pick<ImageModelCapabilities, "resolutions" | "qualities">,
): string {
  const first = caps.resolutions[0] ?? "1K";
  const last = caps.resolutions.at(-1) ?? first;
  const sizes =
    caps.resolutions.length <= 1
      ? `仅 ${first}`
      : caps.resolutions.length === 2
        ? caps.resolutions.join(" / ")
        : `${first}–${last}`;
  return `${sizes} · ${caps.qualities.length > 1 ? `质量 ${caps.qualities.length} 档` : "质量自动"}`;
}

export const RESOLUTIONS = IMAGE_RESOLUTIONS;

/** One line under 画质 for the selected size. */
export const RESOLUTION_HINT: Record<ImageResolution, string> = {
  "1K": "出图快，适合试稿",
  "2K": "细节更多，日常够用",
  "4K": "尺寸最大，适合大图和印刷，耗时更长",
};

export const QUALITIES = IMAGE_QUALITIES;

export const QUALITY_LABEL: Record<ImageQuality, string> = {
  auto: "自动",
  low: "低",
  medium: "中",
  high: "高",
};

/** One line under 质量 for the selected level. */
export const QUALITY_HINT: Record<ImageQuality, string> = {
  auto: "由模型按内容决定",
  low: "最快，适合草稿",
  medium: "速度和细节兼顾",
  high: "细节最多，最慢",
};

export const ASPECT_RATIOS = IMAGE_ASPECT_RATIOS;
export type AspectRatio = ImageAspectRatio;

export function isAspectRatio(value: unknown): value is AspectRatio {
  return (
    typeof value === "string" &&
    (ASPECT_RATIOS as readonly string[]).includes(value)
  );
}

/**
 * "2K · 质量高 · 3:4" for a record. 质量 is left out when it is 自动 or the
 * job predates the setting (null).
 */
export function describeImageParams(params: {
  resolution: ImageResolution;
  quality: ImageQuality | null;
  aspectRatio?: string | null;
}): string {
  return [
    params.resolution,
    params.quality && params.quality !== "auto"
      ? `质量${QUALITY_LABEL[params.quality]}`
      : null,
    params.aspectRatio ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
}
