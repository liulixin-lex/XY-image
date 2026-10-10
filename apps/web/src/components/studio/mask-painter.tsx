"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import {
  MASK_MIN_COVERAGE,
  type MaskStroke,
  drawStroke,
  maskSize,
  paintedShare,
  replayStrokes,
} from "@/lib/mask-edit";

import { useFitBox } from "./use-fit-box";

/** Shown at half strength over the picture (canvas opacity). */
const PAINT = "#ff5a3c";

export type MaskPainterHandle = {
  /** The painted area as a PNG (opaque = change), or null when too little is painted. */
  exportMask: () => Promise<{ blob: Blob; share: number } | null>;
};

/**
 * 局部重绘: paint over the picture where it should change. Strokes are kept
 * by the parent (undo / redo); this draws them on a mask canvas the size of
 * the picture (long edge ≤ 2048) laid over it. Mouse, pen and touch.
 */
export const MaskPainter = forwardRef<
  MaskPainterHandle,
  {
    src: string;
    /** The picture's own size (from the job, or the image once loaded). */
    width: number;
    height: number;
    /** Brush diameter in CSS pixels. */
    brush: number;
    erase: boolean;
    strokes: readonly MaskStroke[];
    onStroke: (stroke: MaskStroke) => void;
  }
>(function MaskPainter({ src, width, height, brush, erase, strokes, onStroke }, ref) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const box = useFitBox(stageRef, width, height);
  const size = maskSize(width, height);
  const drawing = useRef<{ stroke: MaskStroke; pointer: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  // Strokes changed from outside (undo, redo, clear), or the canvas was
  // (re)created and so cleared: redraw them all.
  const mounted = box !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a resized canvas is cleared, so its size re-runs the redraw
  useEffect(() => {
    if (!mounted) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) replayStrokes(ctx, strokes, PAINT);
  }, [strokes, mounted, size.width, size.height]);

  useImperativeHandle(
    ref,
    () => ({
      exportMask: async () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d", { willReadFrequently: true });
        if (!canvas || !ctx) return null;
        const share = paintedShare(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
        if (share < MASK_MIN_COVERAGE) return null;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        return blob ? { blob, share } : null;
      },
    }),
    [],
  );

  /** Pointer position in mask pixels, and the scale from CSS pixels. */
  const locate = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = event.currentTarget.width / Math.max(rect.width, 1);
    return {
      point: [(event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale] as [number, number],
      scale,
      local: { x: event.clientX - rect.left, y: event.clientY - rect.top },
    };
  }, []);

  const finish = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const current = drawing.current;
      if (!current || current.pointer !== event.pointerId) return;
      drawing.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      onStroke(current.stroke);
    },
    [onStroke],
  );

  return (
    <div ref={stageRef} className="flex h-full w-full items-center justify-center">
      {box ? (
        <div
          className="relative overflow-hidden rounded-[12px] shadow-lit"
          style={{ width: box.width, height: box.height }}
        >
          <img src={src} alt="" draggable={false} className="h-full w-full select-none object-fill" />
          <canvas
            ref={canvasRef}
            width={size.width}
            height={size.height}
            aria-label="涂抹区域：按住拖动来涂出要修改的地方"
            className="absolute inset-0 h-full w-full cursor-none touch-none opacity-55"
            onPointerDown={(event) => {
              if (event.button !== 0 && event.pointerType === "mouse") return;
              const { point, scale, local } = locate(event);
              event.currentTarget.setPointerCapture(event.pointerId);
              const stroke: MaskStroke = { erase, size: brush * scale, points: [point] };
              drawing.current = { stroke, pointer: event.pointerId };
              const ctx = event.currentTarget.getContext("2d");
              if (ctx) drawStroke(ctx, stroke, PAINT);
              setCursor(local);
            }}
            onPointerMove={(event) => {
              const { point, local } = locate(event);
              setCursor(local);
              const current = drawing.current;
              if (!current || current.pointer !== event.pointerId) return;
              current.stroke.points.push(point);
              const ctx = event.currentTarget.getContext("2d");
              if (ctx) drawStroke(ctx, current.stroke, PAINT, current.stroke.points.length - 1);
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
            onPointerLeave={(event) => {
              if (!drawing.current) setCursor(null);
              else finish(event);
            }}
          />
          {cursor ? (
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.55)]"
              style={{
                left: cursor.x,
                top: cursor.y,
                width: brush,
                height: brush,
                transform: "translate(-50%, -50%)",
                background: erase ? "rgb(255 255 255 / 0.15)" : "rgb(255 90 60 / 0.18)",
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
