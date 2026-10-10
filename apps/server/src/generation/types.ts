import type { ImageQuality, ImageResolution } from "@loomic/shared";

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
  supportsEdit?: boolean;
  maxInputImages?: number;
}

/**
 * 画质 (output size class) and 质量 (effort level), the product's two image
 * knobs. Each provider translates them into its vendor's own fields; see
 * features/xy2api/catalog.ts for the protocol mapping.
 */
export type { ImageQuality, ImageResolution } from "@loomic/shared";

export type OutputFormat = "png" | "jpg" | "webp";

export interface ImageGenerateParams {
  prompt: string;
  model: string;
  aspectRatio?: string;
  inputImages?: string[];
  /** 画质: 1K / 2K / 4K. */
  resolution?: ImageResolution;
  /** 质量: auto (vendor default) / low / medium / high. */
  quality?: ImageQuality;
  /** Output format preference */
  outputFormat?: OutputFormat;
  metadata?: Record<string, unknown>;
}

export type ImageCallContext = {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
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
