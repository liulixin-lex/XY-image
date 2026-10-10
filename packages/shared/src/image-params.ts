import { z } from "zod";

/**
 * Image request parameters shared by the web app and the server.
 *
 * Two separate knobs, as the vendors define them:
 * - resolution (画质): output size class. OpenAI takes a pixel `size`,
 *   Gemini `imageConfig.imageSize` ("1K" | "2K" | "4K"), xAI `resolution`
 *   ("1k" | "2k"). The server's protocol adapters translate.
 * - quality (质量): how much effort the model spends. OpenAI `quality`
 *   (auto | low | medium | high), xAI `quality` (auto | low | medium), and on
 *   some Gemini models `thinkingLevel`. Models without such a knob list none.
 *
 * Which values a model accepts comes from the server's model catalog
 * (`/api/image-models`), never from these lists alone.
 */
export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export const imageResolutionSchema = z.enum(IMAGE_RESOLUTIONS);

export const IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export const imageQualitySchema = z.enum(IMAGE_QUALITIES);

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
 * - 质量: the requested level, else auto (the vendor's default).
 */
export function resolveImageParams(
  caps: ImageCapabilities,
  requested: {
    resolution?: ImageResolution | undefined;
    quality?: ImageQuality | undefined;
    aspectRatio?: string | null | undefined;
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

  const quality =
    requested.quality && caps.qualities.includes(requested.quality)
      ? requested.quality
      : "auto";
  if (requested.quality && quality !== requested.quality)
    adjusted.push(`quality ${requested.quality}→${quality}`);

  return { resolution, quality, aspectRatio, adjusted };
}
