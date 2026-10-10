import { GoogleGenAI, type Part, ThinkingLevel } from "@google/genai";
import sharp from "sharp";
import {
  type ImageModel,
  type ResolvedImageParams,
  findImageModel,
  resolveImageParams,
} from "../../features/xy2api/catalog.js";
import {
  BillingGuardError,
  GatewayError,
  mapGatewayError,
  neverSent,
  record,
  sanitizeGatewayError,
  withRequestId,
} from "../../features/xy2api/errors.js";
import type {
  GeneratedImage,
  ImageCallContext,
  ImageGenerateParams,
  ImageProvider,
} from "../types.js";
import { fetchReferenceImage } from "./xy2api-reference.js";

const THINKING_LEVELS = new Set<string>(Object.values(ThinkingLevel));

/**
 * Gemini `generationConfig` image fields for one request
 * (https://ai.google.dev/gemini-api/docs/generate-content/image-generation):
 * 画质 → imageConfig.imageSize, 比例 → imageConfig.aspectRatio, 质量 →
 * thinkingConfig.thinkingLevel through the catalog's `vendorQuality`.
 * imageSize is always sent, 1K included: the main site bills Gemini images
 * by it and charges 2K when it is missing (xy2api 0.2.5,
 * gemini_messages_compat_service.go).
 */
export function geminiImageConfig(
  model: Pick<ImageModel, "vendorQuality">,
  resolved: Pick<ResolvedImageParams, "resolution" | "quality" | "aspectRatio">,
) {
  const vendor =
    resolved.quality === "auto"
      ? undefined
      : model.vendorQuality[resolved.quality];
  const thinkingLevel = vendor?.toUpperCase();
  return {
    imageConfig: {
      aspectRatio: resolved.aspectRatio,
      imageSize: resolved.resolution,
    },
    ...(thinkingLevel && THINKING_LEVELS.has(thinkingLevel)
      ? { thinkingConfig: { thinkingLevel: thinkingLevel as ThinkingLevel } }
      : {}),
  };
}

export class Xy2apiGeminiImageProvider implements ImageProvider {
  readonly name = "xy2api-gemini";
  readonly models;
  constructor(private readonly catalog: ImageModel[]) {
    this.models = catalog.filter((model) => model.protocol === "gemini");
  }
  async generate(
    params: ImageGenerateParams,
    ctx?: ImageCallContext,
  ): Promise<GeneratedImage> {
    const model = findImageModel(this.catalog, params.model);
    if (!ctx || !model || model.protocol !== "gemini")
      throw new BillingGuardError("invalid_input");
    const resolved = resolveImageParams(model, {
      resolution: params.resolution,
      quality: params.quality,
      aspectRatio: params.aspectRatio,
    });
    const client = new GoogleGenAI({
      apiKey: ctx.apiKey,
      httpOptions: {
        baseUrl: ctx.baseUrl,
        timeout: 600000,
        // The pinned SDK uses a single fetch when retryOptions is omitted.
        // Setting attempts: 1 discards non-2xx response bodies in this version.
        headers: { "User-Agent": "LoomicServer/1.0" },
      },
    });
    const parts: Part[] = [{ text: params.prompt }];
    for (const source of params.inputImages ?? []) {
      const image = await fetchReferenceImage(source, ctx);
      parts.push({
        inlineData: {
          data: image.bytes.toString("base64"),
          mimeType: image.mimeType,
        },
      });
    }
    // xy2api's id for this call, kept on every failure after it answered so a
    // 待核对 job can be matched to its usage row.
    let requestId: string | undefined;
    try {
      const response = await client.models.generateContent({
        model: params.model,
        contents: [{ role: "user", parts }],
        config: {
          ...(ctx.signal ? { abortSignal: ctx.signal } : {}),
          responseModalities: ["IMAGE"],
          ...geminiImageConfig(model, resolved),
        },
      });
      const candidate = response.candidates?.[0];
      requestId = response.sdkHttpResponse?.headers?.["x-client-request-id"];
      if (
        response.promptFeedback?.blockReason ||
        /SAFETY|PROHIBITED|RECITATION/.test(candidate?.finishReason ?? "")
      )
        throw new GatewayError({
          ...mapGatewayError({ status: 400, body: { code: "safety_filter" } }),
          // The block arrives as HTTP 200 and xy2api bills it (0.2.5 records a
          // 1-image usage row, see __fixtures__/0.2.5/billing.json), so this is
          // not "not charged": mark it for reconciliation instead.
          billing: "unknown",
          userMessage:
            "内容未通过审核，请修改提示词，并到主站用量页核对这次的结果",
        });
      const inline = candidate?.content?.parts?.find(
        (part) => part.inlineData?.data,
      )?.inlineData;
      if (!inline?.data) throw new GatewayError(mapGatewayError({}));
      const bytes = Buffer.from(inline.data, "base64");
      const metadata = await sharp(bytes).metadata();
      if (!metadata.width || !metadata.height)
        throw new GatewayError(mapGatewayError({}));
      const mimeType = inline.mimeType ?? "image/png";
      return {
        url: `data:${mimeType};base64,${inline.data}`,
        mimeType,
        width: metadata.width,
        height: metadata.height,
        ...(requestId ? { requestId } : {}),
      };
    } catch (error) {
      if (error instanceof GatewayError) throw withRequestId(error, requestId);
      if (error instanceof BillingGuardError) throw error;
      // Never left this server (refused, DNS, TLS): not charged.
      if (neverSent(error)) throw sanitizeGatewayError(error);
      const e = record(error);
      let body: unknown;
      try {
        body = JSON.parse(typeof e.message === "string" ? e.message : "");
      } catch {
        body = undefined;
      }
      throw withRequestId(
        new GatewayError(
          mapGatewayError({
            status: typeof e.status === "number" ? e.status : undefined,
            body,
          }),
        ),
        requestId,
      );
    }
  }
}
