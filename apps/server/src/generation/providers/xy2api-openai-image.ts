import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import type { ServerEnv } from "../../config/env.js";
import {
  type ImageModel,
  findImageModel,
} from "../../features/xy2api/catalog.js";
import {
  BillingGuardError,
  GatewayError,
  mapGatewayError,
  sanitizeGatewayError,
} from "../../features/xy2api/errors.js";
import type {
  GeneratedImage,
  ImageCallContext,
  ImageGenerateParams,
  ImageProvider,
} from "../types.js";
import { fetchReferenceImage } from "./xy2api-reference.js";

const sizes: Record<string, [string, string]> = {
  "1:1": ["1024x1024", "2048x2048"],
  "16:9": ["1280x720", "2048x1152"],
  "9:16": ["720x1280", "1152x2048"],
  "4:3": ["1152x864", "2048x1536"],
  "3:4": ["864x1152", "1536x2048"],
};
export class Xy2apiOpenAIImageProvider implements ImageProvider {
  readonly name = "xy2api-openai";
  readonly models;
  constructor(
    private readonly catalog: ImageModel[],
    private readonly env: Pick<
      ServerEnv,
      "imageOutputFormat" | "imageOutputCompression"
    >,
  ) {
    this.models = catalog.filter((model) => model.protocol === "openai-images");
  }
  async generate(
    params: ImageGenerateParams,
    ctx?: ImageCallContext,
  ): Promise<GeneratedImage> {
    const model = findImageModel(this.catalog, params.model);
    if (
      !ctx ||
      !model ||
      model.protocol !== "openai-images" ||
      params.quality === "ultra"
    )
      throw new BillingGuardError("invalid_input", 400);
    const quality =
      params.quality === "hd" && model.maxQuality === "hd" ? "hd" : "standard";
    let size =
      (sizes[params.aspectRatio ?? "1:1"] ?? sizes["1:1"])?.[
        quality === "hd" ? 1 : 0
      ] ?? "1024x1024";
    if (params.model === "gpt-image-1.5")
      size = ["9:16", "3:4"].includes(params.aspectRatio ?? "")
        ? "1024x1536"
        : ["16:9", "4:3"].includes(params.aspectRatio ?? "")
          ? "1536x1024"
          : "1024x1024";
    const client = new OpenAI({
      apiKey: ctx.apiKey,
      baseURL: `${ctx.baseUrl}/v1`,
      timeout: 600000,
      maxRetries: 0,
      defaultHeaders: { "User-Agent": "LoomicServer/1.0" },
    });
    try {
      const request = {
        model: params.model,
        prompt: params.prompt,
        n: 1,
        size: size as "1024x1024",
        quality: quality === "hd" ? ("medium" as const) : ("low" as const),
        output_format: this.env.imageOutputFormat,
        ...(this.env.imageOutputFormat !== "png"
          ? { output_compression: this.env.imageOutputCompression }
          : {}),
      };
      const references = await Promise.all(
        (params.inputImages ?? []).map(async (url, index) => {
          const image = await fetchReferenceImage(url, ctx);
          return toFile(
            image.bytes,
            `reference-${index}.${image.mimeType === "image/jpeg" ? "jpg" : image.mimeType.split("/")[1]}`,
            { type: image.mimeType },
          );
        }),
      );
      const result = await (references.length
        ? client.images.edit(
            { ...request, image: references },
            { signal: ctx.signal },
          )
        : client.images.generate(request, { signal: ctx.signal })
      ).withResponse();
      const output = result.data.data?.[0];
      let bytes: Buffer;
      if (output?.b64_json) bytes = Buffer.from(output.b64_json, "base64");
      else if (output?.url) {
        const url = new URL(output.url);
        if (url.protocol !== "https:")
          throw new Error("Invalid image response");
        const response = await fetch(url, {
          signal: AbortSignal.timeout(60000),
          redirect: "error",
        });
        if (!response.ok) throw new Error("Image download failed");
        bytes = Buffer.from(await response.arrayBuffer());
      } else throw new GatewayError(mapGatewayError({}));
      const metadata = await sharp(bytes).metadata();
      if (!metadata.width || !metadata.height)
        throw new GatewayError(mapGatewayError({}));
      const mimeType = `image/${metadata.format === "jpg" ? "jpeg" : (metadata.format ?? this.env.imageOutputFormat)}`;
      const requestId = result.response.headers.get("x-client-request-id");
      return {
        url: `data:${mimeType};base64,${bytes.toString("base64")}`,
        mimeType,
        width: metadata.width,
        height: metadata.height,
        ...(requestId ? { requestId } : {}),
      };
    } catch (error) {
      if (error instanceof BillingGuardError) throw error;
      throw sanitizeGatewayError(error);
    }
  }
}
