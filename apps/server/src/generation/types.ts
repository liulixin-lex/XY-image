import type {
  ImageBackground,
  ImageEdit,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality,
  ImageResolution,
} from "@loomic/shared";
import type { ImageTaskMode } from "../features/xy2api/image-task.js";

/** Metadata describing a model supported by a provider. */
export interface ModelInfo {
  /** Provider-scoped model ID, e.g. "google/nano-banana-pro" */
  id: string;
  /** Human-readable name shown to users */
  displayName: string;
  /** Short description for LLM model selection */
  description: string;
  /** URL to the model owner's avatar/icon */
  iconUrl?: string;
  /** Image models from the catalog: what the model accepts. */
  resolutions?: readonly string[];
  qualities?: readonly string[];
  aspectRatios?: readonly string[];
  /** 第 66 条, OpenAI models: 背景 and output formats the model takes. */
  backgrounds?: readonly string[];
  outputFormats?: readonly string[];
  supportsEdit?: boolean;
  maxInputImages?: number;
}

/**
 * 画质 (output size class) and 质量 (effort level), the product's two image
 * knobs. Each provider translates them into its vendor's own fields; see
 * features/xy2api/catalog.ts for the protocol mapping.
 */
export type {
  ImageBackground,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality,
  ImageResolution,
} from "@loomic/shared";

export interface ImageGenerateParams {
  /** The user's words; mask edits wrap them (generation/mask-edit.ts). */
  prompt: string;
  model: string;
  aspectRatio?: string;
  inputImages?: string[];
  /** 画质: 1K / 2K / 4K. */
  resolution?: ImageResolution;
  /** 质量: auto (vendor default) / low … max, as the model accepts. */
  quality?: ImageQuality;
  /**
   * 第 66 条, OpenAI only (other providers ignore them): file format (unset:
   * LOOMIC_IMAGE_OUTPUT_FORMAT), jpeg / webp compression, background and
   * moderation (generations only).
   */
  outputFormat?: ImageOutputFormat;
  outputCompression?: number;
  background?: ImageBackground;
  moderation?: ImageModeration;
  metadata?: Record<string, unknown>;
  /** 局部重绘 / 扩图 on inputImages[0]. */
  edit?: ImageEdit;
}

export type ImageCallContext = {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
  /**
   * Make the call an xy2api image task (submit, then poll) instead of one
   * long request. Only the OpenAI and Grok image providers honour it; see
   * features/xy2api/image-task.ts.
   */
  imageTask?: ImageTaskMode;
  /** Public Supabase origin; reference URLs must be storage objects on it. */
  assetOrigin?: string;
  /**
   * Fetcher for those reference URLs. Pass `createSupabaseFetch(env)` so the
   * download goes over SUPABASE_INTERNAL_URL instead of hairpinning through
   * the public domain (M4). Defaults to the global fetch.
   */
  assetFetch?: typeof fetch;
};

export interface GeneratedImage {
  requestId?: string;
  url: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface ImageProvider {
  readonly name: string;
  readonly models: readonly ModelInfo[];
  generate(
    params: ImageGenerateParams,
    ctx?: ImageCallContext,
  ): Promise<GeneratedImage>;
}

export interface VideoGenerateParams {
  prompt: string;
  model: string;
  resolution?: "480p" | "720p" | "1080p";
  duration?: number;
  aspectRatio?: string;
  inputImages?: string[];
  inputVideo?: string;
  /** Enable audio generation (only supported by some providers). */
  enableAudio?: boolean;
}

export interface GeneratedVideo {
  url: string;
  mimeType: string;
  width: number;
  height: number;
  durationSeconds: number;
}

export interface VideoProvider {
  readonly name: string;
  readonly models: readonly VideoModelInfo[];
  generate(params: VideoGenerateParams): Promise<GeneratedVideo>;
}

export interface VideoPriceRate {
  /** Loomic's resolution value sent through the public generation API. */
  resolution: "720p" | "1080p";
  /** Provider-native label shown to users, for example 768P or 2K. */
  displayResolution: string;
  providerPointsPerSecond: number;
  cnyPerSecond: {
    min: number;
    max: number;
  };
}

export interface VideoPricingInfo {
  currency: "CNY";
  billingUnit: "generated_second";
  providerPointsName: string;
  evidenceDate: string;
  rates: readonly VideoPriceRate[];
}

/** Extended model info with video-specific capabilities metadata. */
export interface VideoModelInfo extends ModelInfo {
  capabilities: {
    textToVideo: boolean;
    imageToVideo: boolean;
    videoToVideo: boolean;
    audio: boolean;
  };
  limits: {
    maxDuration: number;
    allowedDurations?: number[];
    maxResolution: "480p" | "720p" | "1080p" | "2160p";
    maxInputImages: number;
  };
  /** Verified provider pricing, separate from Loomic's own credit balance. */
  pricing?: VideoPricingInfo;
}
