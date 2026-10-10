import { z } from "zod";

/**
 * 局部重绘 / 扩图 (mask edits) on one source picture, shared by the studio
 * and the server.
 *
 * - inpaint: the user paints the area to change. `mask` is a PNG uploaded
 *   like a reference image whose opaque pixels mark that area (any size; the
 *   server scales it to the source).
 * - outpaint: the picture is placed in a larger frame of the request's
 *   aspect ratio and the model fills the rest. The server builds the padded
 *   image and its mask from `scale` and `anchor` (see outpaintFrame).
 *
 * The source is the request's only `input_images` entry. How each vendor is
 * asked lives in the server's generation/mask-edit.ts: OpenAI takes a real
 * mask, Gemini gets the source plus a copy with the area highlighted.
 */
export const IMAGE_EDIT_MODES = ["inpaint", "outpaint"] as const;
export type ImageEditMode = (typeof IMAGE_EDIT_MODES)[number];

/** Where the original picture sits in the larger 扩图 frame. */
export const OUTPAINT_ANCHORS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;
export type OutpaintAnchor = (typeof OUTPAINT_ANCHORS)[number];

/** How much bigger than the tightest frame the 扩图 frame may be. */
export const OUTPAINT_MAX_SCALE = 2;

export const imageEditSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("inpaint"),
    mask: z.string().min(1).max(15_000_000),
  }),
  z.object({
    mode: z.literal("outpaint"),
    scale: z.number().min(1).max(OUTPAINT_MAX_SCALE),
    anchor: z.enum(OUTPAINT_ANCHORS),
  }),
]);
export type ImageEdit = z.infer<typeof imageEditSchema>;

/** Labels the studio shows for an edit job. */
export const IMAGE_EDIT_LABEL: Record<ImageEditMode, string> = {
  inpaint: "局部重绘",
  outpaint: "扩图",
};

export type OutpaintFrame = {
  /** The frame, in pixels (long edge at most `maxEdge`). */
  width: number;
  height: number;
  /** Where the source goes in it, and its size there. */
  left: number;
  top: number;
  sourceWidth: number;
  sourceHeight: number;
};

/**
 * The 扩图 frame for a source picture: the tightest frame of `ratio`
 * (width / height) around it, `scale` times larger, with the source at
 * `anchor`, all scaled down so the long edge is at most `maxEdge`.
 * Returns null when nothing would be added (same shape at scale 1).
 */
export function outpaintFrame(
  source: { width: number; height: number },
  ratio: number,
  scale: number,
  anchor: OutpaintAnchor,
  maxEdge = 2048,
): OutpaintFrame | null {
  if (
    !(source.width > 0 && source.height > 0 && ratio > 0 && scale >= 1) ||
    !Number.isFinite(ratio)
  )
    return null;
  const tight =
    ratio >= source.width / source.height
      ? { width: source.height * ratio, height: source.height }
      : { width: source.width, height: source.width / ratio };
  let width = tight.width * scale;
  let height = tight.height * scale;
  // Under 1% more on both sides is not worth a request.
  if (width < source.width * 1.01 && height < source.height * 1.01)
    return null;
  const fit = Math.min(1, maxEdge / Math.max(width, height));
  width = Math.round(width * fit);
  height = Math.round(height * fit);
  const sourceWidth = Math.min(width, Math.round(source.width * fit));
  const sourceHeight = Math.min(height, Math.round(source.height * fit));
  const spareX = width - sourceWidth;
  const spareY = height - sourceHeight;
  const left = anchor.endsWith("left")
    ? 0
    : anchor.endsWith("right")
      ? spareX
      : Math.round(spareX / 2);
  const top = anchor.startsWith("top")
    ? 0
    : anchor.startsWith("bottom")
      ? spareY
      : Math.round(spareY / 2);
  return { width, height, left, top, sourceWidth, sourceHeight };
}
