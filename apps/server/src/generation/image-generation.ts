import { getImageProvider } from "./providers/registry.js";
import type {
  GeneratedImage,
  ImageCallContext,
  ImageGenerateParams,
} from "./types.js";

export async function generateImage(
  providerName: string,
  params: ImageGenerateParams,
  ctx?: ImageCallContext,
): Promise<GeneratedImage> {
  const provider = getImageProvider(providerName);
  return provider.generate(params, ctx);
}
