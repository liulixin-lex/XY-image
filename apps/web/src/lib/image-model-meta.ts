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
  IMAGE_BACKGROUNDS,
  IMAGE_MODERATIONS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_QUALITIES,
  IMAGE_RESOLUTIONS,
  type ImageAspectRatio,
  type ImageBackground,
  type ImageCapabilities,
  type ImageModeration,
  type ImageOutputFormat,
  type ImageQuality,
  type ImageResolution,
  fitsShape,
} from "@loomic/shared";

import type { ImageModelInfo } from "./server-api";

export type {
  ImageBackground,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality,
  ImageResolution,
};

/** The shared ImageCapabilities, filled in for the pickers. */
export type ImageModelCapabilities = {
  resolutions: ImageResolution[];
  /** Empty when the model has no 质量 setting. */
  qualities: ImageQuality[];
  aspectRatios: string[];
  maxRatio: NonNullable<ImageCapabilities["maxRatio"]>;
  /** 0 when the model takes no reference images. */
  maxInputImages: number;
  /** 第 66 条: what 「自动」 amounts to, when the vendor documents it. */
  autoQuality: ImageQuality | null;
  /** 第 66 条, OpenAI models: 背景 / 格式 / 审核 (empty: not offered). */
  backgrounds: ImageBackground[];
  outputFormats: ImageOutputFormat[];
  moderations: ImageModeration[];
  /** What 格式「默认」 sends (the site's setting), when the server says. */
  outputDefaults: { format: ImageOutputFormat; compression: number } | null;
};

/** Options newer than the fallback list; absent means not offered. */
type NewerCapabilities =
  | "autoQuality"
  | "backgrounds"
  | "outputFormats"
  | "moderations"
  | "outputDefaults";

export type ImageModelMeta = Omit<
  ImageModelCapabilities,
  "maxRatio" | NewerCapabilities
> &
  Partial<Pick<ImageModelCapabilities, NewerCapabilities>> & {
  maxRatio?: ImageModelCapabilities["maxRatio"];
  id: string;
  aliases: string[];
  displayName: string;
  maker: string;
  description: string;
  /**
   * What sets this model apart from its siblings, in two to four characters
   * (「效果优先」). Shown next to the name in lists and pickers; most models
   * have none, because a line saying 「生成与多图编辑」 on every row says
   * nothing (第 62 条).
   */
  note?: string;
};

const ALL_RATIOS: string[] = [...IMAGE_ASPECT_RATIOS];
const ALL_QUALITIES: ImageQuality[] = [...IMAGE_QUALITIES];
/** OpenAI's levels before GPT Image 2.5 added xhigh / max. */
const BASE_QUALITIES: ImageQuality[] = ["auto", "low", "medium", "high"];
const OPENAI_OUTPUT = {
  outputFormats: [...IMAGE_OUTPUT_FORMATS],
  moderations: [...IMAGE_MODERATIONS],
} satisfies Partial<ImageModelCapabilities>;
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
    qualities: BASE_QUALITIES,
    aspectRatios: ALL_RATIOS,
    maxRatio: OPENAI_MAX_RATIO,
    maxInputImages: 10,
    ...OPENAI_OUTPUT,
  },
  {
    id: "gpt-image-2.5-sunburst",
    aliases: [],
    displayName: "GPT Image 2.5 Sunburst",
    maker: "OpenAI",
    description: "GPT Image 2.5，效果优先",
    note: "效果优先",
    resolutions: ALL_RESOLUTIONS,
    qualities: ALL_QUALITIES,
    aspectRatios: ALL_RATIOS,
    maxRatio: OPENAI_MAX_RATIO,
    maxInputImages: 10,
    ...OPENAI_OUTPUT,
    backgrounds: [...IMAGE_BACKGROUNDS],
  },
  {
    id: "gpt-image-2.5-flare",
    aliases: [],
    displayName: "GPT Image 2.5 Flare",
    maker: "OpenAI",
    description: "GPT Image 2.5，速度优先",
    note: "速度优先",
    resolutions: ALL_RESOLUTIONS,
    qualities: ALL_QUALITIES,
    aspectRatios: ALL_RATIOS,
    maxRatio: OPENAI_MAX_RATIO,
    maxInputImages: 10,
    ...OPENAI_OUTPUT,
    backgrounds: [...IMAGE_BACKGROUNDS],
  },
  {
    id: "nano-banana-2.1",
    aliases: ["gemini-nano-banana-2.1"],
    displayName: "Nano Banana 2.1",
    maker: "Google",
    description: "生成与多图编辑",
    resolutions: ALL_RESOLUTIONS,
    qualities: BASE_QUALITIES,
    autoQuality: "medium",
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
    description: "生成与多图编辑",
    resolutions: ["1K", "2K"],
    qualities: ["auto", "low", "medium"],
    autoQuality: "low",
    aspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "21:9"],
    // Fallback for servers that do not send capabilities (they predate Grok
    // edits). Current servers send maxInputImages: 3, which wins.
    maxInputImages: 0,
  },
  {
    id: "grok-imagine-image-quality",
    aliases: [],
    displayName: "Grok Imagine 高质量",
    maker: "xAI",
    description: "画质优先，出图稍慢",
    note: "画质优先",
    resolutions: ["1K", "2K"],
    // xAI documents `quality` for grok-imagine-image-2.0 only (第 66 条).
    qualities: [],
    aspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "21:9"],
    maxInputImages: 0,
  },
  {
    id: "grok-imagine-image",
    aliases: [],
    displayName: "Grok Imagine",
    maker: "xAI",
    description: "图像生成",
    resolutions: ["1K", "2K"],
    qualities: [],
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
    autoQuality: "low",
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
    autoQuality: model?.autoQuality ?? meta?.autoQuality ?? null,
    // Unknown models get none of these: they are vendor fields, and a
    // model that does not take them would fail rather than ignore them.
    backgrounds: model?.backgrounds ?? meta?.backgrounds ?? [],
    outputFormats: model?.outputFormats ?? meta?.outputFormats ?? [],
    moderations: model?.moderations ?? meta?.moderations ?? [],
    outputDefaults: model?.outputDefaults ?? null,
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

/**
 * The short note shown after a model's name (「效果优先」), or null. Only
 * models in the known catalog have one; the server's description is a full
 * sentence for the API and is not repeated in the interface (第 62 条).
 */
export function modelNote(id: string | null | undefined): string | null {
  return findModelMeta(id)?.note ?? null;
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
  xhigh: "极高",
  max: "最高",
};

/** One line under 质量 for the selected level. */
export const QUALITY_HINT: Record<ImageQuality, string> = {
  auto: "由模型按内容决定",
  low: "最快，适合草稿",
  medium: "速度和细节兼顾",
  high: "细节更多，较慢",
  xhigh: "比高更细，更慢",
  max: "细节最多，最慢",
};

/**
 * The note under 质量. 「自动」 says what it amounts to when the vendor
 * documents it (Nano Banana 2.1: 中; Grok 2.0: 低), else the plain hint.
 */
export function qualityHint(
  quality: ImageQuality,
  caps: Pick<ImageModelCapabilities, "autoQuality">,
): string {
  if (quality === "auto" && caps.autoQuality && caps.autoQuality !== "auto")
    return `由模型决定，相当于${QUALITY_LABEL[caps.autoQuality]}`;
  return QUALITY_HINT[quality];
}

/** The 质量 levels a picker shows: 自动 plus what the model has. */
export function qualityOptions(
  caps: Pick<ImageModelCapabilities, "qualities">,
): ImageQuality[] {
  return IMAGE_QUALITIES.filter(
    (value) => value === "auto" || caps.qualities.includes(value),
  );
}

// ── 第 66 条: OpenAI output options ─────────────────────────────────────

export const OUTPUT_FORMAT_LABEL: Record<ImageOutputFormat, string> = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
};

export const OUTPUT_FORMAT_HINT: Record<ImageOutputFormat, string> = {
  jpeg: "文件小，适合照片",
  png: "无损，可以保留透明",
  webp: "文件小，适合网页，可以保留透明",
};

export const BACKGROUND_LABEL: Record<ImageBackground, string> = {
  auto: "自动",
  opaque: "不透明",
  transparent: "透明",
};

export const BACKGROUND_HINT: Record<ImageBackground, string> = {
  auto: "由模型决定",
  opaque: "画面铺满，不留透明",
  transparent: "去掉背景，适合标志、贴纸和抠图；存成 PNG 或 WebP",
};

export const MODERATION_LABEL: Record<ImageModeration, string> = {
  auto: "标准",
  low: "宽松",
};

export const MODERATION_HINT: Record<ImageModeration, string> = {
  auto: "OpenAI 默认的内容审核",
  low: "审核放宽一些，仍要遵守 OpenAI 的使用政策",
};

/** 压缩 presets for jpeg / webp (100 = least compressed). */
export const COMPRESSION_PRESETS = [100, 85, 70, 50] as const;

/** 「默认 · JPEG 90」: what the site sends when the user picks nothing. */
export function defaultFormatLabel(
  caps: Pick<ImageModelCapabilities, "outputDefaults">,
): string {
  const d = caps.outputDefaults;
  if (!d) return "默认";
  return d.format === "png"
    ? `默认 · ${OUTPUT_FORMAT_LABEL[d.format]}`
    : `默认 · ${OUTPUT_FORMAT_LABEL[d.format]} ${d.compression}`;
}

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
  /** 第 66 条: only what differs from the defaults is shown. */
  background?: ImageBackground | null;
  outputFormat?: ImageOutputFormat | null;
}): string {
  return [
    params.resolution,
    params.quality && params.quality !== "auto"
      ? `质量${QUALITY_LABEL[params.quality]}`
      : null,
    params.aspectRatio ?? null,
    params.background === "transparent" ? "透明背景" : null,
    params.outputFormat ? OUTPUT_FORMAT_LABEL[params.outputFormat] : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
