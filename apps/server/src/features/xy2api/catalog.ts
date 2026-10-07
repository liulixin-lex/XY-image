import { z } from "zod";

export const imageModelSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._/-]+$/),
  aliases: z.array(z.string().regex(/^[A-Za-z0-9._/-]+$/)).default([]),
  displayName: z.string(),
  description: z.string(),
  protocol: z.enum(["openai-images", "gemini"]),
  platforms: z.array(z.string()),
  supportsEdit: z.boolean(),
  maxInputImages: z.number().int().min(0).max(14),
  maxQuality: z.enum(["standard", "hd"]),
});
export type ImageModel = z.infer<typeof imageModelSchema>;
export const DEFAULT_IMAGE_MODELS: ImageModel[] = [
  {
    id: "gpt-image-2",
    aliases: [],
    displayName: "GPT Image 2",
    description: "OpenAI 图像生成与多图编辑",
    protocol: "openai-images",
    platforms: ["openai", "composite"],
    supportsEdit: true,
    maxInputImages: 10,
    maxQuality: "hd",
  },
  {
    id: "gpt-image-1.5",
    aliases: [],
    displayName: "GPT Image 1.5",
    description: "OpenAI 图像生成",
    protocol: "openai-images",
    platforms: ["openai", "composite"],
    supportsEdit: true,
    maxInputImages: 10,
    maxQuality: "standard",
  },
  {
    id: "gemini-3-pro-image",
    aliases: ["gemini-3-pro-image-preview"],
    displayName: "Nano Banana Pro",
    description: "Gemini 3 Pro 图像生成与编辑",
    protocol: "gemini",
    platforms: ["gemini", "antigravity", "composite"],
    supportsEdit: true,
    maxInputImages: 14,
    maxQuality: "hd",
  },
  {
    id: "gemini-3.1-flash-image",
    aliases: ["gemini-3.1-flash-image-preview"],
    displayName: "Nano Banana 2",
    description: "Gemini 3.1 图像生成，速度更快",
    protocol: "gemini",
    platforms: ["gemini", "antigravity", "composite"],
    supportsEdit: true,
    maxInputImages: 14,
    maxQuality: "hd",
  },
  {
    id: "gemini-2.5-flash-image",
    aliases: ["gemini-2.5-flash-image-preview"],
    displayName: "Nano Banana",
    description: "Gemini 2.5 图像生成，稳定",
    protocol: "gemini",
    platforms: ["gemini", "antigravity", "composite"],
    supportsEdit: true,
    maxInputImages: 14,
    maxQuality: "hd",
  },
  {
    id: "grok-imagine-image",
    aliases: [],
    displayName: "Grok Imagine",
    description: "xAI 图像生成",
    protocol: "openai-images",
    platforms: ["grok", "composite"],
    supportsEdit: false,
    maxInputImages: 0,
    maxQuality: "standard",
  },
];
export function loadImageCatalog(json?: string): ImageModel[] {
  try {
    const models = z
      .array(imageModelSchema)
      .min(1)
      .parse(json ? JSON.parse(json) : DEFAULT_IMAGE_MODELS);
    const ids = models.flatMap((model) => [model.id, ...model.aliases]);
    if (new Set(ids).size !== ids.length) throw new Error();
    return models;
  } catch {
    throw new Error("Invalid LOOMIC_IMAGE_MODELS");
  }
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
