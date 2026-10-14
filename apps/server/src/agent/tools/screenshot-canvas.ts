import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { ReviewImageStore } from "../vision.js";
import type { PersistImageFn } from "./image-generate.js";
import type { ScreenshotResult } from "@loomic/shared";

const screenshotCanvasSchema = z.object({
  mode: z
    .enum(["full", "region", "viewport"])
    .describe("full: all elements; region: specific area; viewport: current user view"),
  region: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional()
    .describe("Required when mode is 'region'. Defines the crop rectangle."),
  max_dimension: z
    .number()
    .default(1024)
    .describe("Max width or height in pixels. 512=low, 1024=medium, 2048=high quality"),
});

/**
 * The page draws every picture of the canvas before answering; with many
 * 4K pictures not yet in its cache that took longer than the old 10 s and
 * the screenshot failed (第 67 条 审图). 60 s; the run is not blocked on
 * anything else meanwhile.
 */
export const SCREENSHOT_RPC_TIMEOUT_MS = 60_000;

export function createScreenshotCanvasTool(deps: {
  connectionManager: ConnectionManager;
  persistImage?: PersistImageFn;
  rpcTimeout?: number;
  /** Keeps the picture so the model is shown it (agent/vision.ts). */
  reviewImages?: ReviewImageStore;
}) {
  const timeout = deps.rpcTimeout ?? SCREENSHOT_RPC_TIMEOUT_MS;

  return new DynamicStructuredTool({
    name: "screenshot_canvas",
    description:
      "Take a visual screenshot of the canvas to inspect layout, design quality, color harmony, and spatial relationships. Use this to visually verify your changes or understand the current canvas state. Supports full canvas, specific region, or current viewport capture.",
    schema: screenshotCanvasSchema,
    func: async (input, _runManager, config): Promise<string> => {
      const userId = (config as any)?.configurable?.user_id;

      if (!userId) {
        return JSON.stringify({
          error: "no_user_context",
          message: "screenshot_canvas requires a user context to communicate with the browser.",
        });
      }

      const started = Date.now();
      try {
        const result = await deps.connectionManager.rpc<ScreenshotResult>(
          userId,
          "canvas.screenshot",
          {
            mode: input.mode,
            ...(input.region ? { region: input.region } : {}),
            max_dimension: input.max_dimension,
          },
          timeout,
        );

        // Upload screenshot to storage to get a short HTTPS URL.
        // Returning the raw data: URI (~1-2 MB base64) in the ToolMessage
        // would be serialized as text by LangChain adapters (Google Gemini,
        // OpenAI) since tool responses only support string content — this
        // causes the conversation to instantly exceed the model's token limit.
        // Pattern: same as generate_image — short URL in JSON, stream-adapter
        // extracts screenshotUrl as a frontend artifact.
        let screenshotUrl: string | undefined;
        if (deps.persistImage) {
          try {
            screenshotUrl = await deps.persistImage(
              result.url,
              "image/png",
              `canvas-screenshot-${input.mode}`,
            );
          } catch {
            // Non-fatal: fall back to text-only summary
          }
        }

        const ref = deps.reviewImages?.addShot(result.url) ?? null;
        console.info(
          `[agent-tool] screenshot_canvas ${input.mode} ${result.width}x${result.height} from the page in ${Date.now() - started}ms${ref ? "" : " (not kept for review)"}`,
        );
        const output: Record<string, unknown> = {
          summary: ref
            ? `Canvas screenshot captured (${result.width}x${result.height}, mode: ${input.mode}). The picture follows as the next message: look at it before judging the layout.`
            : `Canvas screenshot captured (${result.width}x${result.height}, mode: ${input.mode})`,
          width: result.width,
          height: result.height,
          ...(ref ? { reviewImages: [{ ref, label: "画布截图" }] } : {}),
        };

        if (screenshotUrl) {
          output.screenshotUrl = screenshotUrl;
        }

        return JSON.stringify(output);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Screenshot failed";
        console.warn(
          `[agent-tool] screenshot_canvas ${input.mode} failed after ${Date.now() - started}ms: ${message}`,
        );
        return JSON.stringify({
          error: "screenshot_failed",
          message: `Screenshot failed: ${message}`,
        });
      }
    },
  });
}
