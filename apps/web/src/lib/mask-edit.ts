/**
 * 局部重绘 / 扩图 in the studio: the painted mask and the 扩图 settings.
 * The server does the vendor-specific work (apps/server/src/generation/
 * mask-edit.ts); the browser only paints where to change and uploads that
 * as a PNG whose opaque pixels are the area.
 */
import {
  IMAGE_EDIT_LABEL,
  type ImageEditMode,
  type OutpaintAnchor,
  aspectRatioValue,
} from "@loomic/shared";

export { IMAGE_EDIT_LABEL };
export type { ImageEditMode, OutpaintAnchor };

/** One brush or eraser stroke, in mask pixels. */
export type MaskStroke = {
  erase: boolean;
  /** Brush diameter in mask pixels. */
  size: number;
  points: Array<[number, number]>;
};

/** Long edge of the painted mask; the server scales it to the picture. */
export const MASK_MAX_EDGE = 2048;
/** Same floor as the server: less than this is not a real selection. */
export const MASK_MIN_COVERAGE = 0.002;
/** Brush diameter on screen, in CSS pixels. */
export const BRUSH_MIN = 8;
export const BRUSH_MAX = 160;
export const BRUSH_DEFAULT = 48;

/** 扩图 zoom-out choices (1 = only the new shape adds room). */
export const OUTPAINT_SCALES = [1, 1.25, 1.5, 2] as const;
export const OUTPAINT_SCALE_LABEL: Record<(typeof OUTPAINT_SCALES)[number], string> = {
  1: "不放大",
  1.25: "1.25 倍",
  1.5: "1.5 倍",
  2: "2 倍",
};

export const ANCHOR_LABEL: Record<OutpaintAnchor, string> = {
  "top-left": "左上",
  top: "上",
  "top-right": "右上",
  left: "左",
  center: "中间",
  right: "右",
  "bottom-left": "左下",
  bottom: "下",
  "bottom-right": "右下",
};

/** Sent when the 扩图 description is left empty. */
export const DEFAULT_OUTPAINT_PROMPT = "顺着原图自然延伸画面";

/** Mask canvas size for a picture: its own size, long edge at most MASK_MAX_EDGE. */
export function maskSize(width: number, height: number) {
  const fit = Math.min(1, MASK_MAX_EDGE / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * fit)),
    height: Math.max(1, Math.round(height * fit)),
  };
}

/** The listed ratio closest in shape to width × height. */
export function nearestRatio(
  width: number,
  height: number,
  ratios: readonly string[],
): string | null {
  const target = Math.log(width / height);
  let best: string | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const ratio of ratios) {
    const value = aspectRatioValue(ratio);
    if (!value) continue;
    const d = Math.abs(Math.log(value) - target);
    if (d < distance) {
      best = ratio;
      distance = d;
    }
  }
  return best;
}

/**
 * The ratio to ask for when repainting a picture: its own, when the model
 * lists it, else the closest one it does.
 */
export function sourceRatio(
  picture: { aspectRatio: string | null; width: number | null; height: number | null },
  ratios: readonly string[],
): string | null {
  if (picture.aspectRatio && ratios.includes(picture.aspectRatio))
    return picture.aspectRatio;
  if (picture.width && picture.height)
    return nearestRatio(picture.width, picture.height, ratios);
  return picture.aspectRatio ?? null;
}

/** Draws one stroke: round caps, eraser clears. */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: MaskStroke,
  color: string,
  from = 0,
) {
  const points = stroke.points;
  if (!points.length) return;
  ctx.save();
  ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (points.length === 1) {
    const [x, y] = points[0] as [number, number];
    ctx.beginPath();
    ctx.arc(x, y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    const start = points[Math.max(0, from - 1)] as [number, number];
    ctx.moveTo(start[0], start[1]);
    for (let i = Math.max(1, from); i < points.length; i += 1) {
      const [x, y] = points[i] as [number, number];
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Clears the canvas and draws every stroke again (undo, redo, clear). */
export function replayStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly MaskStroke[],
  color: string,
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const stroke of strokes) drawStroke(ctx, stroke, color);
}

/** Share of pixels painted (alpha at least half), as the server counts it. */
export function paintedShare(data: Uint8ClampedArray): number {
  let painted = 0;
  const total = data.length / 4;
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) >= 128) painted += 1;
  return total ? painted / total : 0;
}
