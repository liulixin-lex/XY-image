import type { ServerEnv } from "../../config/env.js";
import { loadImageCatalog } from "../../features/xy2api/catalog.js";
import { clearProviders, registerImageProvider } from "./registry.js";
import { Xy2apiGeminiImageProvider } from "./xy2api-gemini-image.js";
import { Xy2apiOpenAIImageProvider } from "./xy2api-openai-image.js";
import { Xy2apiXaiImageProvider } from "./xy2api-xai-image.js";
export function registerAllProviders(env: ServerEnv): void {
  const catalog = loadImageCatalog(env.imageModelsJson);
  clearProviders();
  registerImageProvider(new Xy2apiOpenAIImageProvider(catalog, env));
  registerImageProvider(new Xy2apiGeminiImageProvider(catalog));
  registerImageProvider(new Xy2apiXaiImageProvider(catalog));
}
