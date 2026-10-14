import { type ImageResolution, aspectRatioValue } from "@loomic/shared";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import type { ServerEnv } from "../../config/env.js";
import {
  type ImageModel,
  findImageModel,
  resolveImageParams,
} from "../../features/xy2api/catalog.js";
import {
  BillingGuardError,
  GatewayError,
  type GatewayDiagnostics,
  gatewayDiagnostics,
  mapGatewayError,
  withRequestId,
} from "../../features/xy2api/errors.js";
import {
  TASK_DEADLINE_MS,
  imageTaskFetch,
  imageTaskOutcome,
} from "../../features/xy2api/image-task.js";
import { XY2API_USER_AGENT } from "../../utils/user-agent.js";
import type {
  GeneratedImage,
  ImageCallContext,
  ImageGenerateParams,
  ImageProvider,
} from "../types.js";
import {
  beforeSending,
  editPrompt,
  frameFor,
  openaiMaskPng,
  orientSource,
  outpaintImages,
  readPaintedMask,
} from "../mask-edit.js";
import {
  downloadImageResult,
  fetchReferenceImage,
} from "./xy2api-reference.js";

// Image API size rules for flexible-size models (gpt-image-2 and later):
// both edges multiples of 16, longest edge at most 3840, long:short at most
// 3:1, total pixels 655,360 to 8,294,400; above 2560x1440 is marked
// experimental. https://developers.openai.com/api/docs/guides/image-generation
//
// The main site (xy2api 0.2.5, image_billing_size.go) bills an OpenAI image
// by the long edge of the picture it returns: ≤ 1024 px is 1K, ≤ 2048 px
// 2K, larger 4K. So each 画质 is a long-edge target, never a pixel budget:
// a 1360x768 "1K" would be charged as 2K.
const LONG_EDGE: Record<ImageResolution, number> = {
  "1K": 1024,
  "2K": 2048,
  "4K": 3840,
};
const MAX_PIXELS = 8_294_400;
const MIN_PIXELS = 655_360;

/**
 * WxH for an OpenAI Image API request: the requested shape at the 画质's
 * long edge (4K is capped by the pixel limit, e.g. 2880x2880 for 1:1, still
 * well above 2048). Shapes too wide for 1K (16:9, 21:9) are moved to 2K by
 * resolveImageParams before this runs (catalog maxRatio).
 * Fixed-size models (gpt-image-1, 1.5) get the closest of their three sizes.
 */
export function openaiImageSize(
  sizing: ImageModel["sizing"],
  resolution: ImageResolution,
  aspectRatio: string,
): string {
  const ratio = Math.min(
    3,
    Math.max(1 / 3, aspectRatioValue(aspectRatio) ?? 1),
  );
  if (sizing === "fixed")
    return ratio > 1.15
      ? "1536x1024"
      : ratio < 0.87
        ? "1024x1536"
        : "1024x1024";
  const floor16 = (value: number) => Math.floor(value / 16) * 16;
  const round16 = (value: number) => Math.round(value / 16) * 16;
  let long = LONG_EDGE[resolution];
  const shape = Math.max(ratio, 1 / ratio);
  if ((long * long) / shape > MAX_PIXELS)
    long = floor16(Math.sqrt(MAX_PIXELS * shape));
  let short = round16(long / shape);
  if (long * short > MAX_PIXELS) short = floor16(long / shape);
  if (long * short < MIN_PIXELS) {
    // Only reachable if a caller skips resolveImageParams; never send an
    // invalid size (a refused call is free, but says nothing useful).
    console.warn(
      `[xy2api-openai] ${resolution} ${aspectRatio} is below the Image API minimum; using the next size up`,
    );
    return resolution === "4K"
      ? "2880x2880"
      : openaiImageSize(sizing, resolution === "1K" ? "2K" : "4K", aspectRatio);
  }
  return ratio >= 1 ? `${long}x${short}` : `${short}x${long}`;
}

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
    if (!ctx || !model || model.protocol !== "openai-images")
      throw new BillingGuardError("invalid_input", 400);
    // The job already holds resolved values; this only guards direct callers.
    const resolved = resolveImageParams(model, {
      resolution: params.resolution,
      quality: params.quality,
      aspectRatio: params.aspectRatio,
      background: params.background,
      outputFormat: params.outputFormat,
      outputCompression: params.outputCompression,
      moderation: params.moderation,
    });
    // 第 66 条: the user's format, else the server's (transparent has
    // already been moved to png by resolveImageParams when needed).
    const format = resolved.outputFormat ?? this.env.imageOutputFormat;
    if (
      resolved.outputFormat ||
      resolved.background !== "auto" ||
      resolved.moderation !== "auto" ||
      resolved.quality === "xhigh" ||
      resolved.quality === "max"
    )
      console.info(
        `[xy2api-openai] ${params.model} quality=${resolved.quality} format=${format}${resolved.outputCompression !== null ? `/${resolved.outputCompression}` : ""} background=${resolved.background} moderation=${resolved.moderation}`,
      );
    const size = openaiImageSize(
      model.sizing,
      resolved.resolution,
      resolved.aspectRatio,
    );
    // The SDK's APIError keeps only `body.error`, but xy2api answers its own
    // refusals with a top-level {code,message} (e.g. 403 INSUFFICIENT_BALANCE).
    // Keep the raw error body of this call so mapping sees what xy2api sent;
    // otherwise a definite refusal would surface as "可能已扣费".
    let errorBody: unknown;
    // xy2api's id for this call, kept on every failure after it answered so a
    // 待核对 job can be matched to its usage row.
    let requestId: string | undefined;
    // Status, edge headers and message of a failed answer, for the worker log
    // and to tell an xy2api refusal from a Cloudflare cut (G7).
    let diagnostics: GatewayDiagnostics | undefined;
    const startedAt = Date.now();
    // Async (features/xy2api/image-task.ts): the SDK still builds and parses
    // the call; this fetch turns it into a task and answers with its result.
    const send = ctx.imageTask
      ? imageTaskFetch(ctx.imageTask, {
          apiKey: ctx.apiKey,
          baseUrl: ctx.baseUrl,
        })
      : fetch;
    const client = new OpenAI({
      apiKey: ctx.apiKey,
      baseURL: `${ctx.baseUrl}/v1`,
      // A task is polled for up to TASK_DEADLINE_MS; one request, 10 minutes.
      timeout: ctx.imageTask ? TASK_DEADLINE_MS + 5 * 60_000 : 600000,
      maxRetries: 0,
      defaultHeaders: { "User-Agent": XY2API_USER_AGENT },
      fetch: async (input, init) => {
        const response = await send(input, init);
        requestId = response.headers.get("x-client-request-id") ?? requestId;
        if (!response.ok) {
          const text = await response
            .clone()
            .text()
            .catch(() => "");
          try {
            errorBody = JSON.parse(text);
          } catch {
            errorBody = undefined;
          }
          diagnostics = gatewayDiagnostics({
            status: response.status,
            headers: response.headers,
            body: errorBody,
            text,
            requestId: response.headers.get("x-client-request-id") ?? undefined,
            startedAt,
          });
        }
        return response;
      },
    });
    // Built before the try: a failure while preparing an edit sends nothing.
    const editInputs = params.edit
      ? await beforeSending("xy2api-openai", () =>
          maskEditInputs(params, resolved.aspectRatio, ctx),
        )
      : null;
    try {
      const request = {
        model: params.model,
        prompt: params.prompt,
        n: 1,
        // The SDK's size union predates flexible WxH sizes.
        size: size as "1024x1024",
        // "auto" is the API default; omit it so gateways that only know
        // low / medium / high still accept the call. xhigh / max (GPT Image
        // 2.5) are newer than the SDK's type.
        ...(resolved.quality !== "auto"
          ? { quality: resolved.quality as "high" }
          : {}),
        output_format: format,
        ...(format !== "png"
          ? {
              output_compression:
                resolved.outputCompression ?? this.env.imageOutputCompression,
            }
          : {}),
        ...(resolved.background !== "auto"
          ? { background: resolved.background }
          : {}),
      };
      // The edit endpoint has no `moderation`; generations only.
      const moderation =
        resolved.moderation !== "auto" ? { moderation: resolved.moderation } : {};
      const result = await (editInputs
        ? client.images.edit(
            { ...request, ...editInputs },
            { signal: ctx.signal },
          )
        : params.inputImages?.length
          ? client.images.edit(
              {
                ...request,
                image: await Promise.all(
                  params.inputImages.map(async (url, index) => {
                    const image = await fetchReferenceImage(url, ctx);
                    return toFile(
                      image.bytes,
                      `reference-${index}.${extension(image.mimeType)}`,
                      { type: image.mimeType },
                    );
                  }),
                ),
              },
              { signal: ctx.signal },
            )
          : client.images.generate(
              { ...request, ...moderation },
              { signal: ctx.signal },
            )
      ).withResponse();
      const output = result.data.data?.[0];
      let bytes: Buffer;
      if (output?.b64_json) bytes = Buffer.from(output.b64_json, "base64");
      // Async results are always links to the main site's object storage.
      else if (output?.url) bytes = await downloadImageResult(output.url);
      else throw new GatewayError(mapGatewayError({}));
      const metadata = await sharp(bytes).metadata();
      if (!metadata.width || !metadata.height)
        throw new GatewayError(mapGatewayError({}));
      const mimeType = `image/${metadata.format === "jpg" ? "jpeg" : (metadata.format ?? format)}`;
      return {
        url: `data:${mimeType};base64,${bytes.toString("base64")}`,
        mimeType,
        width: metadata.width,
        height: metadata.height,
        ...(requestId ? { requestId } : {}),
      };
    } catch (error) {
      // Thrown inside the async fetch, wrapped by the SDK: the fallback
      // signal and parks go up as they are; a 待核对 keeps the task's id.
      const outcome = imageTaskOutcome(error);
      if (outcome) throw outcome;
      requestId ??= ctx.imageTask?.handle?.requestId;
      const seen =
        diagnostics ??
        (error instanceof OpenAI.APIError
          ? undefined
          : { elapsedMs: Date.now() - startedAt });
      if (error instanceof GatewayError)
        throw withRequestId(error, requestId, seen);
      if (error instanceof BillingGuardError) throw error;
      if (
        errorBody !== undefined &&
        error instanceof OpenAI.APIError &&
        typeof error.status === "number"
      )
        throw withRequestId(
          new GatewayError(
            mapGatewayError({
              status: error.status,
              body: errorBody,
              answeredByXy2api: Boolean(requestId),
            }),
          ),
          requestId,
          seen,
        );
      throw withRequestId(error, requestId, seen);
    }
  }
}

function extension(mimeType: string) {
  return mimeType === "image/jpeg" ? "jpg" : (mimeType.split("/")[1] ?? "png");
}

/**
 * 局部重绘 / 扩图: the source (or, for 扩图, the source on a transparent
 * frame), its mask and the wrapped prompt. All built before the call, so a
 * refusal here sends nothing.
 */
async function maskEditInputs(
  params: ImageGenerateParams,
  aspectRatio: string | undefined,
  ctx: ImageCallContext,
) {
  const edit = params.edit;
  const sourceUrl = params.inputImages?.[0];
  if (!edit || !sourceUrl || params.inputImages?.length !== 1)
    throw new BillingGuardError("invalid_input");
  const fetched = await fetchReferenceImage(sourceUrl, ctx);
  const source = await orientSource(fetched.bytes, fetched.mimeType);
  let image: { bytes: Buffer; mimeType: string };
  let mask: Buffer;
  if (edit.mode === "inpaint") {
    const painted = await readPaintedMask(
      (await fetchReferenceImage(edit.mask, ctx)).bytes,
      source.width,
      source.height,
    );
    image = source;
    mask = await openaiMaskPng(painted);
    console.info(
      `[xy2api-openai] inpaint ${source.width}x${source.height}, ${(painted.coverage * 100).toFixed(1)}% painted`,
    );
  } else {
    const frame = frameFor(source, aspectRatio, edit);
    const framed = await outpaintImages(source, frame);
    image = { bytes: framed.image, mimeType: "image/png" };
    mask = framed.mask;
    console.info(
      `[xy2api-openai] outpaint ${source.width}x${source.height} -> ${frame.width}x${frame.height} (${edit.anchor}, x${edit.scale})`,
    );
  }
  return {
    prompt: editPrompt(edit, params.prompt, "openai"),
    image: [
      await toFile(image.bytes, `source.${extension(image.mimeType)}`, {
        type: image.mimeType,
      }),
    ],
    mask: await toFile(mask, "mask.png", { type: "image/png" }),
  };
}
