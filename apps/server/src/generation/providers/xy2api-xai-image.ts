import sharp from "sharp";
import {
  type ImageModel,
  findImageModel,
  resolveImageParams,
} from "../../features/xy2api/catalog.js";
import {
  BillingGuardError,
  GatewayError,
  mapGatewayError,
  record,
  withRequestId,
} from "../../features/xy2api/errors.js";
import type {
  GeneratedImage,
  ImageCallContext,
  ImageGenerateParams,
  ImageProvider,
} from "../types.js";
import { fetchReferenceImage } from "./xy2api-reference.js";

/**
 * xAI Image API through the main site (catalog protocol "xai-images").
 *
 * Unlike OpenAI, xAI takes JSON for edits too (the OpenAI SDK's multipart
 * images.edit is not supported) and sizes by `aspect_ratio` + `resolution`
 * ("1k" | "2k") instead of WxH. `quality` is auto / low / medium.
 * https://docs.x.ai/developers/model-capabilities/images/generation
 * https://docs.x.ai/developers/model-capabilities/images/editing
 * https://docs.x.ai/developers/model-capabilities/images/multi-image-editing
 *
 * Main-site rules (xy2api 0.2.5, grok_media*.go):
 * - It bills the image tier from `size` ("1k" / "2k") when it cannot read the
 *   returned picture's size, and charges 2K when `size` is missing; it then
 *   drops `size` before forwarding. So `size` carries the tier as well.
 * - Several references go as `image` (the first) plus `images` (all), the
 *   shape it builds itself; at most 3 per edit.
 */
export const XAI_MAX_EDIT_IMAGES = 3;

export function xaiImageRequest(
  model: string,
  prompt: string,
  resolved: { resolution: string; quality: string; aspectRatio: string },
  references: string[],
) {
  const images = references.map((url) => ({
    url,
    type: "image_url" as const,
  }));
  const tier = resolved.resolution === "1K" ? "1k" : "2k";
  return {
    model,
    prompt,
    n: 1,
    response_format: "b64_json" as const,
    aspect_ratio: resolved.aspectRatio,
    resolution: tier,
    size: tier,
    ...(resolved.quality !== "auto" ? { quality: resolved.quality } : {}),
    ...(images.length ? { image: images[0] } : {}),
    ...(images.length > 1 ? { images } : {}),
  };
}

export class Xy2apiXaiImageProvider implements ImageProvider {
  readonly name = "xy2api-xai";
  readonly models;
  constructor(private readonly catalog: ImageModel[]) {
    this.models = catalog.filter((model) => model.protocol === "xai-images");
  }
  async generate(
    params: ImageGenerateParams,
    ctx?: ImageCallContext,
  ): Promise<GeneratedImage> {
    const model = findImageModel(this.catalog, params.model);
    if (!ctx || !model || model.protocol !== "xai-images")
      throw new BillingGuardError("invalid_input");
    const resolved = resolveImageParams(model, {
      resolution: params.resolution,
      quality: params.quality,
      aspectRatio: params.aspectRatio,
    });
    if ((params.inputImages?.length ?? 0) > XAI_MAX_EDIT_IMAGES)
      throw new BillingGuardError("invalid_input");
    const references = await Promise.all(
      (params.inputImages ?? []).map(async (source) => {
        const image = await fetchReferenceImage(source, ctx);
        return `data:${image.mimeType};base64,${image.bytes.toString("base64")}`;
      }),
    );
    const body = xaiImageRequest(
      params.model,
      params.prompt,
      resolved,
      references,
    );
    // xy2api's id for this call, kept on every failure after it answered so a
    // 待核对 job can be matched to its usage row.
    let requestId: string | undefined;
    try {
      const timeout = AbortSignal.timeout(600000);
      const response = await fetch(
        `${ctx.baseUrl}/v1/images/${references.length ? "edits" : "generations"}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ctx.apiKey}`,
            "Content-Type": "application/json",
            "User-Agent": "LoomicServer/1.0",
          },
          body: JSON.stringify(body),
          signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
          redirect: "error",
        },
      );
      requestId = response.headers.get("x-client-request-id") ?? undefined;
      const text = await response.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      if (!response.ok)
        throw new GatewayError(
          mapGatewayError({ status: response.status, body: json }),
        );
      const data = record(json).data;
      const output = record(Array.isArray(data) ? data[0] : undefined);
      // xAI reports whether the picture passed its moderation. A blocked one
      // still answers 200, so treat it like Gemini's blocks: 待核对, not free.
      if (output.respect_moderation === false)
        throw new GatewayError({
          ...mapGatewayError({ status: 400, body: { code: "safety_filter" } }),
          billing: "unknown",
          userMessage:
            "内容未通过审核，请修改提示词，并到主站用量页核对这次的结果",
        });
      let bytes: Buffer;
      if (typeof output.b64_json === "string" && output.b64_json)
        bytes = Buffer.from(output.b64_json, "base64");
      else if (typeof output.url === "string") {
        const url = new URL(output.url);
        if (url.protocol !== "https:")
          throw new Error("Invalid image response");
        // No cause chain: a failed download is after the charge, never "not sent".
        const download = await fetch(url, {
          signal: AbortSignal.timeout(60000),
          redirect: "error",
        }).catch(() => {
          throw new Error("Image download failed");
        });
        if (!download.ok) throw new Error("Image download failed");
        bytes = Buffer.from(await download.arrayBuffer());
      } else throw new GatewayError(mapGatewayError({}));
      const metadata = await sharp(bytes).metadata();
      if (!metadata.width || !metadata.height)
        throw new GatewayError(mapGatewayError({}));
      const mimeType = `image/${metadata.format === "jpg" ? "jpeg" : (metadata.format ?? "jpeg")}`;
      return {
        url: `data:${mimeType};base64,${bytes.toString("base64")}`,
        mimeType,
        width: metadata.width,
        height: metadata.height,
        ...(requestId ? { requestId } : {}),
      };
    } catch (error) {
      if (
        error instanceof BillingGuardError &&
        !(error instanceof GatewayError)
      )
        throw error;
      // Refused before sending (DNS, TLS, connect) maps to not charged;
      // anything after that stays 待核对 with the request id when there is one.
      throw withRequestId(error, requestId);
    }
  }
}
