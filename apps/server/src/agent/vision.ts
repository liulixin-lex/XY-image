import {
  HumanMessage,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import sharp from "sharp";

import { findChatProviderError } from "../features/chat-providers/errors.js";
import { GatewayError } from "../features/xy2api/errors.js";
import { findCause } from "../utils/error-chain.js";
import { describeErrorForLog } from "../utils/error-sanitizer.js";

/**
 * 第 67 条 审图: the design assistant looks at pictures for real.
 *
 * Before, screenshot_canvas handed the model a JSON line with a URL (a
 * picture in a tool result is plain text to most adapters), so "verify the
 * layout" meant guessing. Now:
 * - screenshot_canvas keeps the captured picture for this run and returns a
 *   reference (`shot:<id>`); view_images returns references to pictures on
 *   the canvas (`oss://<bucket>/<path>`, read with the user's own storage
 *   client, so row-level security still applies).
 * - createVisionReviewMiddleware shows the pictures behind those references
 *   to the model, as a user message right after the tool results, on every
 *   model call of the run. Only this run's pictures, and only the latest
 *   MAX_REVIEW_IMAGES, so old screenshots never pile up in the context.
 *   Nothing is written to the conversation: the saved history keeps the
 *   small JSON tool result.
 * - Pictures are shrunk to MODEL_IMAGE_EDGE px JPEG first: a 4K PNG is
 *   ~10 MB of base64 on every call; this is ~200 KB, which is what keeps
 *   long review sessions fast and under the gateway's limits.
 * - A model that refuses pictures (400 about images) gets the call again
 *   without them, and the rest of the run goes on without.
 */

export const MODEL_IMAGE_EDGE = 1536;
export const MAX_REVIEW_IMAGES = 3;
/** Tools whose JSON result may carry `reviewImages: [{ref, label}]`. */
export const REVIEW_TOOLS = new Set(["screenshot_canvas", "view_images"]);

export type ReviewImage = { ref: string; label: string };

/** A picture as the model gets it: JPEG data URL, longest edge capped. */
export async function toModelImage(
  bytes: Buffer,
  edge = MODEL_IMAGE_EDGE,
): Promise<{ dataUrl: string; width: number; height: number; size: number }> {
  const { data, info } = await sharp(bytes, { failOn: "none" })
    .rotate()
    .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
    // Transparent logos and stickers read on white.
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return {
    dataUrl: `data:image/jpeg;base64,${data.toString("base64")}`,
    width: info.width,
    height: info.height,
    size: data.length,
  };
}

function bytesOfDataUrl(url: string): Buffer | null {
  const match = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(url);
  return match ? Buffer.from(match[1] ?? "", "base64") : null;
}

export type ReviewImageStore = ReturnType<typeof createReviewImageStore>;

/**
 * Pictures this run may show the model. `readObject` reads an object of the
 * user's storage (null when it cannot); screenshots are kept in memory.
 */
export function createReviewImageStore(deps: {
  readObject?: (bucket: string, path: string) => Promise<Buffer | null>;
}) {
  const shots = new Map<string, Buffer>();
  const produced = new Set<string>();
  const loaded = new Map<string, Promise<string | null>>();
  let next = 0;
  return {
    /** Keeps a screenshot (data URL from the page); its reference, or null. */
    addShot(dataUrl: string): string | null {
      const bytes = bytesOfDataUrl(dataUrl);
      if (!bytes) return null;
      const ref = `shot:${++next}`;
      shots.set(ref, bytes);
      produced.add(ref);
      return ref;
    },
    /** Marks a reference as produced by a tool of this run. */
    note(ref: string) {
      produced.add(ref);
    },
    producedThisRun(ref: string) {
      return produced.has(ref);
    },
    /** The picture as a model-ready data URL (cached for the run). */
    load(ref: string): Promise<string | null> {
      let pending = loaded.get(ref);
      if (!pending) {
        pending = (async () => {
          let bytes: Buffer | null = shots.get(ref) ?? null;
          const oss = /^oss:\/\/([^/]+)\/(.+)$/.exec(ref);
          if (!bytes && oss && deps.readObject)
            bytes = await deps.readObject(oss[1] ?? "", oss[2] ?? "");
          if (!bytes) return null;
          const started = Date.now();
          const image = await toModelImage(bytes);
          console.info(
            `[agent-vision] ${ref.startsWith("shot:") ? "screenshot" : "canvas picture"} ${(bytes.length / 1024).toFixed(0)} KB → ${image.width}x${image.height} ${(image.size / 1024).toFixed(0)} KB in ${Date.now() - started}ms`,
          );
          return image.dataUrl;
        })().catch((error) => {
          console.warn(
            `[agent-vision] picture not loaded: ${describeErrorForLog(error)}`,
          );
          return null;
        });
        loaded.set(ref, pending);
      }
      return pending;
    },
  };
}

/** `reviewImages` of a review tool's JSON result. */
export function reviewImagesOf(message: BaseMessage): ReviewImage[] {
  if (!ToolMessage.isInstance(message)) return [];
  if (!REVIEW_TOOLS.has(message.name ?? "")) return [];
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .map((part) =>
              typeof part === "string"
                ? part
                : typeof (part as { text?: unknown }).text === "string"
                  ? (part as { text: string }).text
                  : "",
            )
            .join("")
        : "";
  try {
    const parsed = JSON.parse(text) as { reviewImages?: unknown };
    if (!Array.isArray(parsed.reviewImages)) return [];
    return parsed.reviewImages.flatMap((item) => {
      const i = item as { ref?: unknown; label?: unknown };
      return typeof i.ref === "string"
        ? [{ ref: i.ref, label: typeof i.label === "string" ? i.label : "图片" }]
        : [];
    });
  } catch {
    return [];
  }
}

/** A 400/422 that says the model cannot take pictures. */
export function refusesImages(error: unknown): boolean {
  const gateway = findCause(
    error,
    (c): c is GatewayError => c instanceof GatewayError,
  );
  if (gateway) {
    const d = gateway.failure.diagnostics;
    return (
      (d?.status === 400 || d?.status === 422) &&
      /image|vision|multimodal|multi-modal|图片|图像/i.test(
        `${d?.errorId ?? ""} ${d?.message ?? ""}`,
      )
    );
  }
  const provider = findChatProviderError(error);
  return provider?.refusedOption === "image";
}

/**
 * The request's messages with the pictures inserted: after the block of tool
 * results that holds each review tool's result (tool results of one model
 * turn must stay together), as one user message per block.
 */
export function withReviewImages(
  messages: BaseMessage[],
  pictures: Map<string, string>,
  keep: Set<string>,
): BaseMessage[] {
  const out: BaseMessage[] = [];
  let pending: { label: string; url: string }[] = [];
  const flush = () => {
    if (!pending.length) return;
    out.push(
      new HumanMessage({
        content: [
          {
            type: "text",
            text: `（${pending.map((p) => p.label).join("、")}：工具返回的图片，供你检查，不是用户发的）`,
          },
          // Same shape as chat attachments (runtime.ts): the OpenAI and
          // Gemini adapters both read it.
          ...pending.map((p) => ({ type: "image_url" as const, image_url: p.url })),
        ],
      }),
    );
    pending = [];
  };
  for (const message of messages) {
    if (!ToolMessage.isInstance(message)) flush();
    out.push(message);
    for (const image of reviewImagesOf(message)) {
      const url = keep.has(image.ref) ? pictures.get(image.ref) : undefined;
      if (url) pending.push({ label: image.label, url });
    }
  }
  flush();
  return out;
}

export function createVisionReviewMiddleware(
  store: ReviewImageStore,
  options: { maxImages?: number } = {},
) {
  const maxImages = options.maxImages ?? MAX_REVIEW_IMAGES;
  let off = false;
  return createMiddleware({
    name: "LoomicVisionReview",
    wrapModelCall: async (request, handler) => {
      if (off) return handler(request);
      const refs = request.messages
        .flatMap(reviewImagesOf)
        .map((image) => image.ref)
        .filter((ref) => store.producedThisRun(ref));
      const keep = new Set([...new Set(refs)].slice(-maxImages));
      if (!keep.size) return handler(request);
      const pictures = new Map<string, string>();
      await Promise.all(
        [...keep].map(async (ref) => {
          const url = await store.load(ref);
          if (url) pictures.set(ref, url);
        }),
      );
      if (!pictures.size) return handler(request);
      try {
        return await handler({
          ...request,
          messages: withReviewImages(request.messages, pictures, keep),
        });
      } catch (error) {
        if (!refusesImages(error)) throw error;
        off = true;
        console.warn(
          "[agent-vision] the model refused pictures; this run goes on without showing them",
        );
        return handler(request);
      }
    },
  });
}
