import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_BACKGROUNDS,
  IMAGE_MODERATIONS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_QUALITIES,
  IMAGE_RESOLUTIONS,
  type ImageBackground,
  type ImageModeration,
  type ImageOutputFormat,
  type ImageQuality,
  type ImageResolution,
  type ResolvedImageParams,
  resolveImageParams as resolveSharedImageParams,
} from "@loomic/shared";

export type { ResolvedImageParams };
import { z } from "zod";

/**
 * Image model catalog. Each entry says which wire protocol the main site
 * (xy2api) speaks for the model and which 画质 / 质量 / 比例 it accepts; the
 * protocol adapters in generation/providers/xy2api-*-image.ts translate the
 * product parameters into each vendor's own fields:
 *
 * - "openai-images": OpenAI Image API (images.generate / images.edit).
 *   画质 → pixel `size` (WxH), 质量 → `quality`, 格式 / 压缩 / 背景 / 审核 →
 *   `output_format` / `output_compression` / `background` / `moderation`
 *   (第 66 条; moderation on generations only, the edit endpoint has none).
 * - "gemini": Gemini generateContent. 画质 → `imageConfig.imageSize`,
 *   比例 → `imageConfig.aspectRatio`, 质量 → `thinkingConfig.thinkingLevel`
 *   on models that have one (via `vendorQuality`).
 * - "xai-images": xAI Image API (JSON generations / edits).
 *   画质 → `resolution` ("1k" | "2k"), 质量 → `quality`, 比例 → `aspect_ratio`.
 *
 * Adding a model: append an entry here, or set LOOMIC_IMAGE_MODELS to a JSON
 * array of entries (it replaces the defaults). Fields left out take the
 * protocol's defaults below. A model on a new wire protocol needs a new
 * adapter registered in register-all.ts.
 */
export const IMAGE_PROTOCOLS = [
  "openai-images",
  "gemini",
  "xai-images",
] as const;
export type ImageProtocol = (typeof IMAGE_PROTOCOLS)[number];

const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9._/-]+$/)
  .max(200);
const ratioSchema = z.string().regex(/^\d{1,2}(\.\d)?:\d{1,2}(\.\d)?$/);

/** What a protocol accepts when the catalog entry does not say. */
const PROTOCOL_DEFAULTS: Record<
  ImageProtocol,
  {
    vendor: string;
    resolutions: ImageResolution[];
    qualities: ImageQuality[];
    aspectRatios: string[];
    backgrounds: ImageBackground[];
    outputFormats: ImageOutputFormat[];
    moderations: ImageModeration[];
  }
> = {
  "openai-images": {
    vendor: "openai",
    resolutions: ["1K", "2K", "4K"],
    qualities: ["auto", "low", "medium", "high"],
    aspectRatios: [...IMAGE_ASPECT_RATIOS],
    // Transparent backgrounds are per model (full support on GPT Image 2.5,
    // preview on gpt-image-2): off unless the entry lists them.
    backgrounds: [],
    outputFormats: [...IMAGE_OUTPUT_FORMATS],
    moderations: [...IMAGE_MODERATIONS],
  },
  // 1K is every Gemini image model's default size; 2K / 4K only on newer ones.
  gemini: {
    vendor: "google",
    resolutions: ["1K", "2K"],
    qualities: [],
    aspectRatios: [...IMAGE_ASPECT_RATIOS],
    backgrounds: [],
    outputFormats: [],
    moderations: [],
  },
  // https://docs.x.ai/developers/model-capabilities/images/generation
  "xai-images": {
    vendor: "xai",
    resolutions: ["1K", "2K"],
    // `quality` is grok-imagine-image-2.0 only; the other Grok models
    // list none (catalog entries below).
    qualities: ["auto", "low", "medium"],
    aspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "21:9"],
    backgrounds: [],
    outputFormats: [],
    moderations: [],
  },
};

export const imageModelSchema = z
  .object({
    /** Id the main site lists; sent upstream as the model name. */
    id: idSchema,
    /** Other ids the main site may list for the same model. */
    aliases: z.array(idSchema).default([]),
    displayName: z.string().min(1).max(60),
    description: z.string().max(120),
    /** Maker, for grouping in the picker: openai, google, xai, … */
    vendor: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .optional(),
    protocol: z.enum(IMAGE_PROTOCOLS),
    /** xy2api platforms that serve it, used when the key's model list is unknown. */
    platforms: z.array(z.string()),
    supportsEdit: z.boolean(),
    maxInputImages: z.number().int().min(0).max(14),
    /** 画质 the model accepts. */
    resolutions: z.array(z.enum(IMAGE_RESOLUTIONS)).min(1).optional(),
    /** 质量 the model accepts; empty when it has no such setting. */
    qualities: z.array(z.enum(IMAGE_QUALITIES)).optional(),
    aspectRatios: z.array(ratioSchema).min(1).optional(),
    /**
     * Vendor value for each 质量 when the vendor names it differently, e.g.
     * Gemini thinkingLevel { low: "minimal", high: "high" }. Levels without an
     * entry send nothing (the vendor default).
     */
    vendorQuality: z
      .partialRecord(z.enum(IMAGE_QUALITIES), z.string())
      .optional(),
    /**
     * The level 质量「自动」 amounts to when the vendor documents one (Nano
     * Banana 2.1: medium, Nano Banana 2: minimal = low, Grok 2.0: low for
     * generations). Only shown as a hint; auto still sends nothing.
     */
    autoQuality: z.enum(IMAGE_QUALITIES).optional(),
    /** 背景 the model accepts; empty when it has no such setting. */
    backgrounds: z.array(z.enum(IMAGE_BACKGROUNDS)).optional(),
    /** Output formats the user may pick; empty = the server's default only. */
    outputFormats: z.array(z.enum(IMAGE_OUTPUT_FORMATS)).optional(),
    /** 审核 levels; empty when the model has no such setting. */
    moderations: z.array(z.enum(IMAGE_MODERATIONS)).optional(),
    /**
     * openai-images only. "flexible": any WxH within the Image API limits
     * (gpt-image-2 and later). "fixed": only 1024x1024 / 1536x1024 /
     * 1024x1536 (gpt-image-1, gpt-image-1.5).
     */
    sizing: z.enum(["flexible", "fixed"]).optional(),
    /**
     * Widest long:short shape per 画质 when narrower than `aspectRatios`
     * (see ImageCapabilities.maxRatio). openai-images defaults: flexible
     * { "1K": 1.6 }, fixed { "1K": 1 } (their non-square sizes are 1536 px,
     * which the main site bills as 2K).
     */
    maxRatio: z
      .partialRecord(z.enum(IMAGE_RESOLUTIONS), z.number().min(1).max(10))
      .optional(),
    /**
     * Catalog v1 field, still read from LOOMIC_IMAGE_MODELS: "standard" meant
     * 1K only, "hd" 1K and 2K. Ignored when `resolutions` is set.
     */
    maxQuality: z.enum(["standard", "hd"]).optional(),
  })
  .transform(({ maxQuality, ...model }) => {
    const defaults = PROTOCOL_DEFAULTS[model.protocol];
    const resolutions =
      model.resolutions ??
      (maxQuality === "standard"
        ? (["1K"] as ImageResolution[])
        : maxQuality === "hd"
          ? (["1K", "2K"] as ImageResolution[])
          : defaults.resolutions);
    return {
      ...model,
      vendor: model.vendor ?? defaults.vendor,
      resolutions: IMAGE_RESOLUTIONS.filter((value) =>
        resolutions.includes(value),
      ),
      qualities: IMAGE_QUALITIES.filter((value) =>
        (model.qualities ?? defaults.qualities).includes(value),
      ),
      aspectRatios: model.aspectRatios ?? defaults.aspectRatios,
      vendorQuality: model.vendorQuality ?? {},
      backgrounds: IMAGE_BACKGROUNDS.filter((value) =>
        (model.backgrounds ?? defaults.backgrounds).includes(value),
      ),
      outputFormats: IMAGE_OUTPUT_FORMATS.filter((value) =>
        (model.outputFormats ?? defaults.outputFormats).includes(value),
      ),
      moderations: IMAGE_MODERATIONS.filter((value) =>
        (model.moderations ?? defaults.moderations).includes(value),
      ),
      sizing: model.sizing ?? ("flexible" as const),
      maxRatio:
        model.maxRatio ??
        (model.protocol === "openai-images"
          ? { "1K": model.sizing === "fixed" ? 1 : 1.6 }
          : {}),
    };
  });
export type ImageModel = z.output<typeof imageModelSchema>;

/** Registered provider (generation/providers/register-all.ts) for each protocol. */
export const IMAGE_PROVIDER_BY_PROTOCOL: Record<ImageProtocol, string> = {
  "openai-images": "xy2api-openai",
  gemini: "xy2api-gemini",
  "xai-images": "xy2api-xai",
};
export type ImageModelEntry = z.input<typeof imageModelSchema>;

const GEMINI_PLATFORMS = ["gemini", "antigravity", "composite"];
const OPENAI_PLATFORMS = ["openai", "composite"];

/**
 * Default catalog, in picker order. Descriptions stay factual: what the
 * vendor says the model is for, nothing measured by us.
 * Sources: https://developers.openai.com/api/docs/guides/image-generation,
 * https://ai.google.dev/gemini-api/docs/generate-content/image-generation,
 * https://docs.x.ai/developers/model-capabilities/images/generation
 */
export const DEFAULT_IMAGE_MODELS: ImageModelEntry[] = [
  {
    id: "gpt-image-2",
    displayName: "GPT Image 2",
    description: "OpenAI 图像生成与多图编辑",
    protocol: "openai-images",
    platforms: OPENAI_PLATFORMS,
    supportsEdit: true,
    maxInputImages: 10,
  },
  // GPT Image 2.5 adds 质量 xhigh / max and fully supports transparent
  // backgrounds (gpt-image-2: preview only, so not offered there).
  {
    id: "gpt-image-2.5-sunburst",
    displayName: "GPT Image 2.5 Sunburst",
    description: "OpenAI GPT Image 2.5，效果优先",
    protocol: "openai-images",
    platforms: OPENAI_PLATFORMS,
    supportsEdit: true,
    maxInputImages: 10,
    qualities: [...IMAGE_QUALITIES],
    backgrounds: [...IMAGE_BACKGROUNDS],
  },
  {
    id: "gpt-image-2.5-flare",
    displayName: "GPT Image 2.5 Flare",
    description: "OpenAI GPT Image 2.5，速度优先",
    protocol: "openai-images",
    platforms: OPENAI_PLATFORMS,
    supportsEdit: true,
    maxInputImages: 10,
    qualities: [...IMAGE_QUALITIES],
    backgrounds: [...IMAGE_BACKGROUNDS],
  },
  {
    id: "nano-banana-2.1",
    aliases: ["gemini-nano-banana-2.1"],
    displayName: "Nano Banana 2.1",
    description: "Google 图像生成与多图编辑",
    protocol: "gemini",
    platforms: GEMINI_PLATFORMS,
    supportsEdit: true,
    maxInputImages: 14,
    resolutions: ["1K", "2K", "4K"],
    qualities: ["auto", "low", "medium", "high"],
    vendorQuality: { low: "minimal", medium: "medium", high: "high" },
    autoQuality: "medium",
  },
  {
    id: "nano-banana-pro",
    aliases: ["gemini-3-pro-image", "gemini-3-pro-image-preview"],
    displayName: "Nano Banana Pro",
    description: "Google Gemini 3 Pro 图像生成与多图编辑",
    protocol: "gemini",
    platforms: GEMINI_PLATFORMS,
    supportsEdit: true,
    maxInputImages: 14,
    resolutions: ["1K", "2K", "4K"],
  },
  {
    id: "grok-imagine-image-2.0",
    displayName: "Grok Imagine 2.0",
    description: "xAI 图像生成与编辑",
    protocol: "xai-images",
    platforms: ["grok", "composite"],
    // Edits take JSON `image` (+ `images`, + `mask`), verified through the
    // pre-launch main site (xy2api 0.2.6) on 2026-10-11: one and two source
    // images, and a mask. xAI allows five sources; xy2api caps an edit at 3.
    supportsEdit: true,
    maxInputImages: 3,
    // xAI: auto is low for generations, medium for edits.
    autoQuality: "low",
  },
  // The Grok-image group lists these next to 2.0 (FINDINGS K1). Same
  // xai-images protocol; edits stay off until verified per model.
  {
    id: "grok-imagine-image-quality",
    displayName: "Grok Imagine 高质量",
    description: "xAI 图像生成，画质优先，出图稍慢",
    protocol: "xai-images",
    platforms: ["grok", "composite"],
    supportsEdit: false,
    maxInputImages: 0,
    // `quality` is documented for grok-imagine-image-2.0 only.
    qualities: [],
  },
  {
    id: "grok-imagine-image",
    displayName: "Grok Imagine",
    description: "xAI 图像生成",
    protocol: "xai-images",
    platforms: ["grok", "composite"],
    supportsEdit: false,
    maxInputImages: 0,
    qualities: [],
  },
  {
    id: "gemini-3.1-flash-image",
    aliases: ["gemini-3.1-flash-image-preview", "nano-banana-2"],
    displayName: "Nano Banana 2",
    description: "Google Gemini 3.1 Flash 图像生成与多图编辑",
    protocol: "gemini",
    platforms: GEMINI_PLATFORMS,
    supportsEdit: true,
    maxInputImages: 14,
    resolutions: ["1K", "2K", "4K"],
    qualities: ["auto", "low", "high"],
    vendorQuality: { low: "minimal", high: "high" },
    autoQuality: "low",
  },
];

export function loadImageCatalog(json?: string): ImageModel[] {
  try {
    const models = z
      .array(imageModelSchema)
      .min(1)
      .parse(json ? JSON.parse(json) : DEFAULT_IMAGE_MODELS);
    const ids = models.flatMap((model) => [model.id, ...model.aliases]);
    if (new Set(ids).size !== ids.length) throw new Error("duplicate id");
    return models;
  } catch (error) {
    // Never echo the JSON itself: ops may paste it from a secret store.
    console.error(
      `[image-catalog] LOOMIC_IMAGE_MODELS rejected: ${error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : error instanceof SyntaxError ? "not valid JSON" : error instanceof Error ? error.message : "unknown"}`,
    );
    throw new Error("Invalid LOOMIC_IMAGE_MODELS");
  }
}

/**
 * 局部重绘 / 扩图 (generation/mask-edit.ts): OpenAI and xAI take the source
 * and a mask; Gemini takes the source plus a highlighted copy, so it needs
 * room for two images.
 */
export function supportsMaskEdit(
  model: Pick<ImageModel, "protocol" | "supportsEdit" | "maxInputImages">,
): boolean {
  if (!model.supportsEdit) return false;
  if (model.protocol === "openai-images") return model.maxInputImages >= 1;
  if (model.protocol === "gemini") return model.maxInputImages >= 2;
  if (model.protocol === "xai-images") return model.maxInputImages >= 1;
  return false;
}

export function findImageModel(
  catalog: ImageModel[],
  id: string,
): ImageModel | undefined {
  const model = catalog.find(
    (item) => item.id === id || item.aliases.includes(id),
  );
  return model ? { ...model, id } : undefined;
}

export function matchImageModels(
  catalog: ImageModel[],
  platform: string,
  available: string[],
): string[] {
  const matches = catalog.flatMap((model) => {
    const found = [model.id, ...model.aliases].find((id) =>
      available.includes(id),
    );
    return found ? [found] : [];
  });
  return matches.length
    ? matches
    : catalog
        .filter((model) => model.platforms.includes(platform))
        .map((model) => model.id);
}

// Names that are clearly not chat models even when absent from the catalog.
const NON_CHAT_MODEL =
  /image|imagine|banana|dall-e|sora|veo|video|seedream|seedance|kling|flux|midjourney|embed|tts|whisper|audio|transcri|realtime|moderation|rerank/i;

/** False for ids that name an image, video, speech or embedding model. */
export function looksLikeChatModel(id: string): boolean {
  return !NON_CHAT_MODEL.test(id);
}

/**
 * Chat models offered for a key, in LOOMIC_CHAT_MODELS order. A `*` entry
 * adds every other model the key lists that is not an image/media model, so
 * chat models the main site adds later show up without a redeploy; without
 * `*` the list is a strict allowlist.
 */
export function pickChatModels(
  catalog: ImageModel[],
  wanted: string[],
  listed: string[],
): string[] {
  const named = wanted.filter((id) => id !== "*" && listed.includes(id));
  if (!wanted.includes("*")) return named;
  const imageIds = new Set(catalog.flatMap((m) => [m.id, ...m.aliases]));
  return [
    ...named,
    ...listed.filter(
      (id) =>
        !named.includes(id) && !imageIds.has(id) && !NON_CHAT_MODEL.test(id),
    ),
  ];
}

/**
 * The 画质 / 质量 / 比例 actually sent for a catalog model; the rules live in
 * @loomic/shared so the pickers show exactly what the server will send.
 */
export function resolveImageParams(
  model: Pick<
    ImageModel,
    "resolutions" | "qualities" | "aspectRatios" | "maxRatio"
  > &
    Partial<Pick<ImageModel, "backgrounds" | "outputFormats" | "moderations">>,
  requested: Parameters<typeof resolveSharedImageParams>[1],
): ResolvedImageParams {
  return resolveSharedImageParams(model, requested);
}
