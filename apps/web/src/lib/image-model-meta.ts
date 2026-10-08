/**
 * Client-side hints for image models. Mirrors the server's default catalog
 * (apps/server/src/features/xy2api/catalog.ts). The server stays the
 * authority: it re-validates model access, quality and reference images on
 * every request, and deployments may override the catalog. Unknown models
 * fall back to permissive hints and let the server decide.
 */
export type ImageModelMeta = {
  id: string;
  aliases: string[];
  displayName: string;
  maker: string;
  description: string;
  maxQuality: "standard" | "hd";
  maxInputImages: number;
};

export const KNOWN_IMAGE_MODELS: ImageModelMeta[] = [
  {
    id: "gpt-image-2",
    aliases: [],
    displayName: "GPT Image 2",
    maker: "OpenAI",
    description: "生成与多图编辑",
    maxQuality: "hd",
    maxInputImages: 10,
  },
  {
    id: "gpt-image-1.5",
    aliases: [],
    displayName: "GPT Image 1.5",
    maker: "OpenAI",
    description: "图像生成",
    maxQuality: "standard",
    maxInputImages: 10,
  },
  {
    id: "gemini-3-pro-image",
    aliases: ["gemini-3-pro-image-preview"],
    displayName: "Nano Banana Pro",
    maker: "Google",
    description: "Gemini 3 Pro 生成与编辑",
    maxQuality: "hd",
    maxInputImages: 14,
  },
  {
    id: "gemini-3.1-flash-image",
    aliases: ["gemini-3.1-flash-image-preview"],
    displayName: "Nano Banana 2",
    maker: "Google",
    description: "Gemini 3.1，速度更快",
    maxQuality: "hd",
    maxInputImages: 14,
  },
  {
    id: "gemini-2.5-flash-image",
    aliases: ["gemini-2.5-flash-image-preview"],
    displayName: "Nano Banana",
    maker: "Google",
    description: "Gemini 2.5，稳定",
    maxQuality: "hd",
    maxInputImages: 14,
  },
  {
    id: "grok-imagine-image",
    aliases: [],
    displayName: "Grok Imagine",
    maker: "xAI",
    description: "文生图，不支持参考图",
    maxQuality: "standard",
    maxInputImages: 0,
  },
];

export function findModelMeta(id: string | null | undefined) {
  if (!id) return undefined;
  return KNOWN_IMAGE_MODELS.find(
    (model) => model.id === id || model.aliases.includes(id),
  );
}

/** Reference-image limit for a model id; unknown models defer to the server. */
export function maxReferenceImages(id: string | null | undefined): number {
  return findModelMeta(id)?.maxInputImages ?? 14;
}

export const QUALITY_LABEL: Record<"standard" | "hd", string> = {
  standard: "1K",
  hd: "2K",
};

export const ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
