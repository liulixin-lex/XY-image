import { tool } from "langchain";
import { z } from "zod";

import type { ReviewImage, ReviewImageStore } from "../vision.js";

/**
 * view_images (第 67 条 审图): the model looks at pictures on the canvas —
 * what it generated, references the user placed — to check composition,
 * lettering, artefacts and style against the brief before it reports back.
 * It returns references only; agent/vision.ts shows the pictures as the next
 * message (shrunk to 1536 px JPEG), read with the user's own storage client.
 */
const viewImagesSchema = z.object({
  element_ids: z
    .array(z.string().min(1))
    .min(1)
    .max(4)
    .describe(
      "Image element ids on the canvas (from inspect_canvas, or the elementId generate_image returned). Up to 4 at a time.",
    ),
});

type CanvasContent = {
  elements?: Array<Record<string, unknown>>;
  files?: Record<string, Record<string, unknown>>;
};

/** Where an image element's picture is: an oss:// or https reference. */
export function pictureRef(
  element: Record<string, unknown>,
  files: CanvasContent["files"],
): string | null {
  const fileId = typeof element.fileId === "string" ? element.fileId : null;
  const file = fileId ? files?.[fileId] : undefined;
  const url = typeof file?.dataURL === "string" ? file.dataURL : null;
  if (url && /^(oss:\/\/|https:\/\/)/.test(url)) return url;
  return null;
}

function labelOf(element: Record<string, unknown>): string {
  const custom = (element.customData ?? {}) as Record<string, unknown>;
  const title = [custom.title, custom.name, element.name].find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  return title ? `「${title.trim().slice(0, 30)}」` : `图片 ${String(element.id).slice(0, 8)}`;
}

export function createViewImagesTool(deps: {
  createUserClient: (accessToken: string) => any;
  reviewImages: ReviewImageStore;
}) {
  return tool(
    async (input, config) => {
      const canvasId = (config as any)?.configurable?.canvas_id;
      const accessToken = (config as any)?.configurable?.access_token;
      if (!canvasId || !accessToken)
        return JSON.stringify({
          error: "no_canvas_context",
          message: "This tool needs a canvas.",
        });
      const { data, error } = await deps
        .createUserClient(accessToken)
        .from("canvases")
        .select("content")
        .eq("id", canvasId)
        .single();
      if (error && !error.code) throw new Error(`canvas read failed: ${error.message}`);
      if (error || !data)
        return JSON.stringify({
          error: "canvas_not_found",
          message: "Canvas not found or access denied.",
        });
      const content = (data.content ?? {}) as CanvasContent;
      const live = (content.elements ?? []).filter((el) => !el.isDeleted);
      const images: ReviewImage[] = [];
      const missing: string[] = [];
      for (const id of new Set(input.element_ids)) {
        const element = live.find((el) => el.id === id);
        const ref = element && element.type === "image" ? pictureRef(element, content.files) : null;
        if (!element || !ref) {
          missing.push(id);
          continue;
        }
        deps.reviewImages.note(ref);
        images.push({ ref, label: labelOf(element) });
      }
      console.info(
        `[agent-tool] view_images ${images.length} shown, ${missing.length} not found`,
      );
      return JSON.stringify({
        summary: images.length
          ? `${images.length} picture(s) follow as the next message. Check them against the request (subject, composition, lettering, artefacts, style) and say what to fix, if anything.`
          : "None of these ids is an image on the canvas. Use inspect_canvas with filter_type ['image'] to find them.",
        shown: images.length,
        ...(missing.length ? { notFound: missing } : {}),
        reviewImages: images,
      });
    },
    {
      name: "view_images",
      description:
        "Look at pictures on the canvas (generated results, references) to review them: composition, lettering, artefacts, style, brand fit. Returns them as the next message. Use after generating when quality matters, or when the user asks you to judge or compare pictures.",
      schema: viewImagesSchema,
    },
  );
}
