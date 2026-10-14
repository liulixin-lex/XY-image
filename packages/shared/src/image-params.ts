import { z } from "zod";

/**
 * Image request parameters shared by the web app and the server.
 *
 * Two separate knobs, as the vendors define them:
 * - resolution (画质): output size class. OpenAI takes a pixel `size`,
 *   Gemini `imageConfig.imageSize` ("1K" | "2K" | "4K"), xAI `resolution`
 *   ("1k" | "2k"). The server's protocol adapters translate.
 * - quality (质量): how much effort the model spends. OpenAI `quality`
 *   (auto | low | medium | high; GPT Image 2.5 also xhigh | max), xAI
 *   `quality` (auto | low | medium, grok-imagine-image-2.0 only), and on
 *   some Gemini models `thinkingLevel`. Models without such a knob list none.
 * - output (第 66 条, OpenAI only): file format, compression, background
 *   (transparent needs png / webp) and moderation.
 *
 * Which values a model accepts comes from the server's model catalog
 * (`/api/image-models`), never from these lists alone. Vendor references:
 * docs/XY_IMAGE_IMAGE_PARAMS.md.
 */
export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export const imageResolutionSchema = z.enum(IMAGE_RESOLUTIONS);

/**
 * 质量, lowest effort first after auto. xhigh / max exist only on OpenAI's
 * GPT Image 2.5 models (Sunburst, Flare); see the catalog per model.
 */
export const IMAGE_QUALITIES = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export const imageQualitySchema = z.enum(IMAGE_QUALITIES);

/** OpenAI `background`. transparent needs png or webp output. */
export const IMAGE_BACKGROUNDS = ["auto", "opaque", "transparent"] as const;
export type ImageBackground = (typeof IMAGE_BACKGROUNDS)[number];
export const imageBackgroundSchema = z.enum(IMAGE_BACKGROUNDS);

/** OpenAI `output_format`; the server's LOOMIC_IMAGE_OUTPUT_FORMAT when unset. */
export const IMAGE_OUTPUT_FORMATS = ["jpeg", "png", "webp"] as const;
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];
export const imageOutputFormatSchema = z.enum(IMAGE_OUTPUT_FORMATS);

/** OpenAI `output_compression` for jpeg / webp: 0–100, 100 = least compressed. */
export const imageOutputCompressionSchema = z.number().int().min(0).max(100);

/** OpenAI `moderation` (generations only): low = less restrictive filtering. */
export const IMAGE_MODERATIONS = ["auto", "low"] as const;
export type ImageModeration = (typeof IMAGE_MODERATIONS)[number];
export const imageModerationSchema = z.enum(IMAGE_MODERATIONS);

/**
 * Aspect ratios the product offers. A model supports a subset (catalog
 * `aspectRatios`); "auto" is not offered because every vendor reads it
 * differently.
 */
export const IMAGE_ASPECT_RATIOS = [
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
  "4:5",
  "5:4",
  "21:9",
] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

/** Values older clients and stored jobs used for `quality` (1K / 2K / 4K). */
export const LEGACY_IMAGE_QUALITIES = ["standard", "hd", "ultra"] as const;
export type LegacyImageQuality = (typeof LEGACY_IMAGE_QUALITIES)[number];

/**
 * What the old single `quality` field asked for. Besides the size it sent
 * OpenAI `quality` low (standard) or medium (hd), so a queued job or an old
 * page keeps getting exactly what it got before.
 */
export const LEGACY_IMAGE_PARAMS: Record<
  LegacyImageQuality,
  { resolution: ImageResolution; quality: ImageQuality }
> = {
  standard: { resolution: "1K", quality: "low" },
  hd: { resolution: "2K", quality: "medium" },
  ultra: { resolution: "4K", quality: "auto" },
};

export function isLegacyImageQuality(
  value: unknown,
): value is LegacyImageQuality {
  return (
    typeof value === "string" &&
    (LEGACY_IMAGE_QUALITIES as readonly string[]).includes(value)
  );
}

/**
 * Reads resolution and quality from a request or a stored job payload,
 * including the old shape where `quality` alone meant the size
 * (LEGACY_IMAGE_PARAMS). Unknown values fall back to the defaults.
 */
export function normalizeImageParams(
  input: { resolution?: unknown; quality?: unknown },
  defaults: { resolution: ImageResolution; quality: ImageQuality } = {
    resolution: "2K",
    quality: "auto",
  },
): { resolution: ImageResolution; quality: ImageQuality } {
  if (input.resolution === undefined && isLegacyImageQuality(input.quality))
    return { ...LEGACY_IMAGE_PARAMS[input.quality] };
  const resolution = imageResolutionSchema.safeParse(input.resolution);
  const quality = imageQualitySchema.safeParse(input.quality);
  return {
    resolution: resolution.success ? resolution.data : defaults.resolution,
    quality: quality.success ? quality.data : defaults.quality,
  };
}

/** Width / height of an "a:b" ratio, or null when it is not one. */
export function aspectRatioValue(ratio: string): number | null {
  const [w, h] = ratio.split(":").map(Number);
  return w && h && Number.isFinite(w) && Number.isFinite(h) ? w / h : null;
}

/** What a model accepts, from the server's image catalog. */
export type ImageCapabilities = {
  resolutions: readonly ImageResolution[];
  /** Empty when the model has no 质量 setting. */
  qualities: readonly ImageQuality[];
  /** 背景 options; empty / absent when the model has no such setting. */
  backgrounds?: readonly ImageBackground[] | undefined;
  /** Output formats the user may pick; empty / absent = the server's default. */
  outputFormats?: readonly ImageOutputFormat[] | undefined;
  /** 审核 options; empty / absent when the model has no such setting. */
  moderations?: readonly ImageModeration[] | undefined;
  aspectRatios: readonly string[];
  /**
   * Widest shape (long side / short side) the model can make at a 画质, when
   * that is narrower than its ratio list. OpenAI at 1K is 1.6: the main site
   * bills by the long edge (≤ 1024 px is 1K) and OpenAI needs at least
   * 655,360 px, so 16:9 cannot be 1K.
   */
  maxRatio?: Partial<Record<ImageResolution, number>> | undefined;
};

export type ResolvedImageParams = {
  resolution: ImageResolution;
  quality: ImageQuality;
  aspectRatio: string;
  background: ImageBackground;
  /** null: the server's default format (LOOMIC_IMAGE_OUTPUT_FORMAT). */
  outputFormat: ImageOutputFormat | null;
  /** jpeg / webp only; null: the server's default compression. */
  outputCompression: number | null;
  moderation: ImageModeration;
  /** Requested values the model does not accept, and what was used instead. */
  adjusted: string[];
};

/** True when `ratio` can be made at `resolution` (see ImageCapabilities.maxRatio). */
export function fitsShape(
  caps: Pick<ImageCapabilities, "maxRatio">,
  resolution: ImageResolution,
  ratio: string,
): boolean {
  const limit = caps.maxRatio?.[resolution];
  const value = aspectRatioValue(ratio);
  if (!limit || !value) return true;
  return Math.max(value, 1 / value) <= limit + 1e-6;
}

/**
 * The 画质 / 质量 / 比例 actually sent for a model. Unsupported requests are
 * moved to the closest supported value rather than refused (an older page or
 * the agent may ask for something the picker would not offer). The server
 * stores the result in the job; the pickers use the same function to show
 * what will be sent.
 *
 * - 比例: the nearest supported shape (log distance, so 2:3 and 3:2 are
 *   equally far from 1:1).
 * - 画质: the requested one, else the largest supported below it, else the
 *   smallest; then up to the next one that can make the shape (maxRatio).
 * - 质量: the requested level, else the model's highest level below it (a
 *   template's 「最高」 on a model that stops at 高 runs at 高), else its
 *   lowest above it, else auto (the vendor's default).
 * - 背景 / 格式 / 审核: the requested value when the model offers it, else
 *   the default (auto / the server's format / auto). A transparent background
 *   needs png or webp, so jpeg or the default format becomes png.
 * - 压缩: jpeg / webp only, 0–100.
 */
export function resolveImageParams(
  caps: ImageCapabilities,
  requested: {
    resolution?: ImageResolution | undefined;
    quality?: ImageQuality | undefined;
    aspectRatio?: string | null | undefined;
    background?: ImageBackground | undefined;
    outputFormat?: ImageOutputFormat | null | undefined;
    outputCompression?: number | null | undefined;
    moderation?: ImageModeration | undefined;
  },
): ResolvedImageParams {
  const adjusted: string[] = [];

  const ratio = requested.aspectRatio ?? "1:1";
  let aspectRatio = caps.aspectRatios.includes(ratio)
    ? ratio
    : (caps.aspectRatios[0] ?? "1:1");
  const target = aspectRatioValue(ratio);
  if (!caps.aspectRatios.includes(ratio) && target) {
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of caps.aspectRatios) {
      const value = aspectRatioValue(candidate);
      if (!value) continue;
      const distance = Math.abs(Math.log(value / target));
      if (distance < best) {
        best = distance;
        aspectRatio = candidate;
      }
    }
  }
  if (aspectRatio !== ratio && requested.aspectRatio)
    adjusted.push(`aspect ${ratio}→${aspectRatio}`);

  const wanted = requested.resolution ?? "2K";
  const rank = IMAGE_RESOLUTIONS.indexOf(wanted);
  let resolution: ImageResolution = caps.resolutions.includes(wanted)
    ? wanted
    : ([...caps.resolutions]
        .reverse()
        .find((value) => IMAGE_RESOLUTIONS.indexOf(value) < rank) ??
      caps.resolutions[0] ??
      "1K");
  if (!fitsShape(caps, resolution, aspectRatio)) {
    const larger = caps.resolutions.find(
      (value) =>
        IMAGE_RESOLUTIONS.indexOf(value) >
          IMAGE_RESOLUTIONS.indexOf(resolution) &&
        fitsShape(caps, value, aspectRatio),
    );
    if (larger) resolution = larger;
  }
  if (resolution !== wanted && requested.resolution)
    adjusted.push(`resolution ${wanted}→${resolution}`);

  const quality = closestQuality(caps.qualities, requested.quality);
  if (requested.quality && quality !== requested.quality)
    adjusted.push(`quality ${requested.quality}→${quality}`);

  let outputFormat =
    requested.outputFormat &&
    (caps.outputFormats ?? []).includes(requested.outputFormat)
      ? requested.outputFormat
      : null;
  if (requested.outputFormat && outputFormat !== requested.outputFormat)
    adjusted.push(`format ${requested.outputFormat}→default`);

  const background =
    requested.background &&
    (caps.backgrounds ?? []).includes(requested.background)
      ? requested.background
      : "auto";
  if (requested.background && background !== requested.background)
    adjusted.push(`background ${requested.background}→auto`);
  if (background === "transparent" && outputFormat !== "webp" && outputFormat !== "png") {
    adjusted.push(`format ${outputFormat ?? "default"}→png (transparent)`);
    outputFormat = "png";
  }

  const outputCompression =
    (outputFormat === "jpeg" || outputFormat === "webp") &&
    typeof requested.outputCompression === "number" &&
    Number.isFinite(requested.outputCompression)
      ? Math.min(100, Math.max(0, Math.round(requested.outputCompression)))
      : null;

  const moderation =
    requested.moderation &&
    (caps.moderations ?? []).includes(requested.moderation)
      ? requested.moderation
      : "auto";
  if (requested.moderation && moderation !== requested.moderation)
    adjusted.push(`moderation ${requested.moderation}→auto`);

  return {
    resolution,
    quality,
    aspectRatio,
    background,
    outputFormat,
    outputCompression,
    moderation,
    adjusted,
  };
}

/**
 * The 质量 to send for `wanted` on a model offering `offered`: itself when
 * offered, else the highest offered level below it, else the lowest above
 * it, else auto. auto always stays auto.
 */
export function closestQuality(
  offered: readonly ImageQuality[],
  wanted: ImageQuality | undefined,
): ImageQuality {
  if (!wanted || wanted === "auto") return "auto";
  if (offered.includes(wanted)) return wanted;
  const rank = IMAGE_QUALITIES.indexOf(wanted);
  const levels = IMAGE_QUALITIES.filter(
    (value) => value !== "auto" && offered.includes(value),
  );
  return (
    [...levels].reverse().find((value) => IMAGE_QUALITIES.indexOf(value) < rank) ??
    levels.find((value) => IMAGE_QUALITIES.indexOf(value) > rank) ??
    "auto"
  );
}
