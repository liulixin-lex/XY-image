/**
 * Draws canvas elements to a 2D canvas: the project thumbnail and the
 * screenshots the design assistant asks for (`canvas.screenshot`). React Flow
 * draws with DOM nodes, so these come from this renderer, not the editor.
 *
 * Pictures load with `crossOrigin = "anonymous"` (storage serves CORS), so
 * the result can be read back; a picture that fails to load is drawn as a
 * blank tile rather than failing the whole image.
 */
import { lineBox } from "./adapter";
import { readNumber } from "./element";
import { readGenerator } from "./generator";
import { type Rect, boundsOf, overlaps } from "./layout";
import type { SceneElement, SceneFiles } from "./types";

export type RenderPalette = {
  background: string;
  panel: string;
  fg: string;
  muted: string;
  line: string;
  accent: string;
  tile: string;
};

export const RENDER_PALETTES: Record<"light" | "dark", RenderPalette> = {
  light: {
    background: "#f5f2f3",
    panel: "#fbfafb",
    fg: "#24212b",
    muted: "#6f6a78",
    line: "rgba(36,33,43,0.18)",
    accent: "#e5533d",
    tile: "#e6e1e4",
  },
  dark: {
    background: "#1c1a22",
    panel: "#25222c",
    fg: "#f2eff4",
    muted: "#a39dad",
    line: "rgba(242,239,244,0.18)",
    accent: "#ff8068",
    tile: "#131118",
  },
};

const FONT =
  '"PingFang SC", "Hiragino Sans GB", -apple-system, "Segoe UI", sans-serif';
/** Stroke colours that mean "the default ink", drawn in the theme's ink. */
const DEFAULT_INKS = new Set(["#1e1e1e", "#000000", "#000"]);

export type ImageLoader = (src: string) => Promise<CanvasImageSource | null>;

export type RenderInput = {
  elements: readonly SceneElement[];
  files: SceneFiles;
  theme: "light" | "dark";
  /** Longest side of the result in pixels. */
  maxDimension: number;
  /** Scene area to draw; default: everything. */
  bounds?: Rect;
  padding?: number;
  /** Small scenes are enlarged at most this much. */
  maxScale?: number;
};

export type RenderDeps = {
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  loadImage?: ImageLoader;
};

/** The box an element covers on the canvas. */
export function elementRect(el: SceneElement): Rect {
  if (el.type === "line" || el.type === "arrow" || el.type === "freedraw") {
    const box = lineBox(el);
    return {
      x: el.x + box.minX,
      y: el.y + box.minY,
      width: box.width,
      height: box.height,
    };
  }
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

/** The picture source of an image element: stored URL, else inline data. */
export function imageSourceOf(
  el: SceneElement,
  files: SceneFiles,
): string | null {
  const fileId = typeof el.fileId === "string" ? el.fileId : null;
  const file = fileId ? files[fileId] : undefined;
  const stored = el.customData?.storageUrl;
  return (
    file?.storageUrl ??
    file?.dataURL ??
    (typeof stored === "string" && stored ? stored : null)
  );
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

export const loadImageAnonymous: ImageLoader = (src) => {
  let pending = imageCache.get(src);
  if (!pending) {
    pending = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.warn("[node-canvas/render] picture not loaded for drawing");
        imageCache.delete(src);
        resolve(null);
      };
      img.src = src;
    });
    imageCache.set(src, pending);
  }
  return pending;
};

function defaultCreateCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function renderScene(
  input: RenderInput,
  deps: RenderDeps = {},
): Promise<HTMLCanvasElement | null> {
  const createCanvas = deps.createCanvas ?? defaultCreateCanvas;
  const loadImage = deps.loadImage ?? loadImageAnonymous;
  const palette = RENDER_PALETTES[input.theme];
  const padding = input.padding ?? 32;

  const live = input.elements.filter((el) => !el.isDeleted);
  const area = input.bounds ?? boundsOf(live.map(elementRect));
  if (!area || area.width <= 0 || area.height <= 0) return null;
  const visible = input.bounds
    ? live.filter((el) => overlaps(elementRect(el), area))
    : live;

  const sceneWidth = area.width + padding * 2;
  const sceneHeight = area.height + padding * 2;
  const scale = Math.min(
    input.maxScale ?? 2,
    input.maxDimension / Math.max(sceneWidth, sceneHeight),
  );
  const width = Math.max(1, Math.round(sceneWidth * scale));
  const height = Math.max(1, Math.round(sceneHeight * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Every picture loads in parallel before drawing starts.
  const pictures = new Map<string, CanvasImageSource | null>();
  await Promise.all(
    visible
      .filter((el) => el.type === "image")
      .map(async (el) => {
        const src = imageSourceOf(el, input.files);
        pictures.set(el.id, src ? await loadImage(src) : null);
      }),
  );

  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(padding - area.x, padding - area.y);

  const byId = new Map(live.map((el) => [el.id, el]));
  const order = (el: SceneElement) =>
    el.type === "frame" || el.type === "magicframe"
      ? 0
      : el.type === "arrow"
        ? 1
        : 2;
  const sorted = [...visible].sort((a, b) => order(a) - order(b));
  for (const el of sorted) {
    ctx.save();
    ctx.globalAlpha = Math.min(
      1,
      Math.max(0, readNumber(el.opacity, 100) / 100),
    );
    try {
      drawElement(ctx, el, {
        palette,
        byId,
        picture: pictures.get(el.id) ?? null,
      });
    } catch (error) {
      console.warn(
        `[node-canvas/render] ${el.type} ${el.id} not drawn:`,
        error,
      );
    }
    ctx.restore();
  }
  ctx.restore();
  return canvas;
}

export async function renderSceneToBlob(
  input: RenderInput,
  type: "image/png" | "image/webp" = "image/png",
  quality?: number,
  deps?: RenderDeps,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const canvas = await renderScene(input, deps);
  if (!canvas) return null;
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  );
  return blob ? { blob, width: canvas.width, height: canvas.height } : null;
}

type DrawContext = {
  palette: RenderPalette;
  byId: Map<string, SceneElement>;
  picture: CanvasImageSource | null;
};

function ink(color: unknown, palette: RenderPalette): string {
  if (typeof color !== "string" || !color) return palette.fg;
  return DEFAULT_INKS.has(color.toLowerCase()) ? palette.fg : color;
}

function fill(color: unknown): string | null {
  return typeof color === "string" && color && color !== "transparent"
    ? color
    : null;
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  const rr = Math.max(0, Math.min(radius, r.width / 2, r.height / 2));
  ctx.beginPath();
  ctx.moveTo(r.x + rr, r.y);
  ctx.arcTo(r.x + r.width, r.y, r.x + r.width, r.y + r.height, rr);
  ctx.arcTo(r.x + r.width, r.y + r.height, r.x, r.y + r.height, rr);
  ctx.arcTo(r.x, r.y + r.height, r.x, r.y, rr);
  ctx.arcTo(r.x, r.y, r.x + r.width, r.y, rr);
  ctx.closePath();
}

/** Lines of `text` that fit `maxWidth`, broken anywhere (CJK has no spaces). */
export function wrapText(
  ctx: Pick<CanvasRenderingContext2D, "measureText">,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of paragraph) {
      if (line && ctx.measureText(line + char).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: Rect,
  opts: {
    size: number;
    color: string;
    align?: CanvasTextAlign;
    wrap?: boolean;
  },
) {
  ctx.font = `${opts.size}px ${FONT}`;
  ctx.fillStyle = opts.color;
  ctx.textBaseline = "top";
  ctx.textAlign = opts.align ?? "left";
  const lineHeight = opts.size * 1.35;
  const lines = opts.wrap ? wrapText(ctx, text, box.width) : text.split("\n");
  const fit = Math.max(1, Math.floor(box.height / lineHeight));
  const x =
    opts.align === "center"
      ? box.x + box.width / 2
      : opts.align === "right"
        ? box.x + box.width
        : box.x;
  lines.slice(0, fit).forEach((line, i) => {
    const last = i === fit - 1 && lines.length > fit;
    ctx.fillText(
      last ? `${line.slice(0, -1)}…` : line,
      x,
      box.y + i * lineHeight,
    );
  });
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  el: SceneElement,
  dc: DrawContext,
) {
  const { palette } = dc;
  const r = elementRect(el);
  const strokeWidth = Math.max(1, readNumber(el.strokeWidth, 1));
  switch (el.type) {
    case "image": {
      if (dc.picture) {
        ctx.save();
        roundRect(ctx, r, 10);
        ctx.clip();
        ctx.drawImage(dc.picture, r.x, r.y, r.width, r.height);
        ctx.restore();
      } else {
        ctx.fillStyle = palette.tile;
        roundRect(ctx, r, 10);
        ctx.fill();
      }
      return;
    }
    case "embeddable":
    case "iframe": {
      ctx.fillStyle = palette.tile;
      roundRect(ctx, r, 10);
      ctx.fill();
      // A play mark for videos.
      const s = Math.min(r.width, r.height) * 0.18;
      ctx.fillStyle = palette.muted;
      ctx.beginPath();
      ctx.moveTo(r.x + r.width / 2 - s / 2, r.y + r.height / 2 - s / 2);
      ctx.lineTo(r.x + r.width / 2 + s / 2, r.y + r.height / 2);
      ctx.lineTo(r.x + r.width / 2 - s / 2, r.y + r.height / 2 + s / 2);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case "text": {
      const align =
        el.textAlign === "center" || el.textAlign === "right"
          ? el.textAlign
          : "left";
      drawTextBlock(
        ctx,
        typeof el.text === "string" ? el.text : "",
        { ...r, height: r.height + 2 },
        {
          size: readNumber(el.fontSize, 20),
          color: ink(el.strokeColor, palette),
          align,
        },
      );
      return;
    }
    case "prompt":
    case "generator": {
      ctx.fillStyle = palette.panel;
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1;
      roundRect(ctx, r, 16);
      ctx.fill();
      ctx.stroke();
      const inner = {
        x: r.x + 16,
        y: r.y + 14,
        width: r.width - 32,
        height: r.height - 28,
      };
      if (el.type === "prompt") {
        drawTextBlock(ctx, "提示词", inner, { size: 12, color: palette.muted });
        drawTextBlock(
          ctx,
          typeof el.text === "string" ? el.text : "",
          { ...inner, y: inner.y + 22, height: inner.height - 22 },
          { size: 14, color: palette.fg, wrap: true },
        );
        return;
      }
      const config = readGenerator(el);
      drawTextBlock(ctx, "生成", inner, { size: 14, color: palette.fg });
      drawTextBlock(
        ctx,
        [
          config.model || "默认模型",
          config.aspectRatio,
          config.resolution,
          `${config.count} 张`,
        ].join(" · "),
        { ...inner, y: inner.y + 24, height: 18 },
        { size: 12, color: palette.muted },
      );
      if (config.prompt) {
        drawTextBlock(
          ctx,
          config.prompt,
          { ...inner, y: inner.y + 52, height: inner.height - 52 },
          { size: 13, color: palette.fg, wrap: true },
        );
      }
      return;
    }
    case "frame":
    case "magicframe": {
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      roundRect(ctx, r, 12);
      ctx.stroke();
      ctx.setLineDash([]);
      if (typeof el.name === "string" && el.name) {
        drawTextBlock(
          ctx,
          el.name,
          { x: r.x, y: r.y - 22, width: r.width, height: 18 },
          {
            size: 13,
            color: palette.muted,
          },
        );
      }
      return;
    }
    case "rectangle":
    case "ellipse":
    case "diamond": {
      ctx.beginPath();
      if (el.type === "rectangle") {
        roundRect(
          ctx,
          r,
          el.roundness ? Math.min(16, r.width / 4, r.height / 4) : 0,
        );
      } else if (el.type === "ellipse") {
        ctx.ellipse(
          r.x + r.width / 2,
          r.y + r.height / 2,
          r.width / 2,
          r.height / 2,
          0,
          0,
          Math.PI * 2,
        );
      } else {
        ctx.moveTo(r.x + r.width / 2, r.y);
        ctx.lineTo(r.x + r.width, r.y + r.height / 2);
        ctx.lineTo(r.x + r.width / 2, r.y + r.height);
        ctx.lineTo(r.x, r.y + r.height / 2);
        ctx.closePath();
      }
      const background = fill(el.backgroundColor);
      if (background) {
        ctx.fillStyle = background;
        ctx.fill();
      }
      ctx.strokeStyle = ink(el.strokeColor, palette);
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
      return;
    }
    case "arrow":
    case "line":
    case "freedraw": {
      const source = bound(el.startBinding, dc.byId);
      const target = bound(el.endBinding, dc.byId);
      ctx.strokeStyle =
        el.type === "arrow" && source && target
          ? palette.accent
          : ink(el.strokeColor, palette);
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (el.type === "arrow" && source && target) {
        drawFlowEdge(ctx, source, target);
        return;
      }
      const points = Array.isArray(el.points)
        ? (el.points as [number, number][])
        : [];
      if (points.length < 2) return;
      ctx.beginPath();
      points.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(el.x + px, el.y + py);
        else ctx.lineTo(el.x + px, el.y + py);
      });
      ctx.stroke();
      if (el.type === "arrow" && el.endArrowhead) {
        const [ax, ay] = points[points.length - 2] as [number, number];
        const [bx, by] = points[points.length - 1] as [number, number];
        drawArrowhead(
          ctx,
          el.x + ax,
          el.y + ay,
          el.x + bx,
          el.y + by,
          10 + strokeWidth * 2,
        );
      }
      return;
    }
    default:
      return;
  }
}

function bound(
  binding: unknown,
  byId: Map<string, SceneElement>,
): SceneElement | null {
  const id = (binding as { elementId?: unknown } | null | undefined)?.elementId;
  return typeof id === "string" ? (byId.get(id) ?? null) : null;
}

/** The editor's edge: a curve from the source's right side to the target's left. */
function drawFlowEdge(
  ctx: CanvasRenderingContext2D,
  source: SceneElement,
  target: SceneElement,
) {
  const sx = source.x + source.width;
  const sy = source.y + source.height / 2;
  const tx = target.x;
  const ty = target.y + target.height / 2;
  const offset = Math.max(40, Math.abs(tx - sx) / 2);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.bezierCurveTo(sx + offset, sy, tx - offset, ty, tx, ty);
  ctx.stroke();
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  size: number,
) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.beginPath();
  ctx.moveTo(
    toX - size * Math.cos(angle - Math.PI / 7),
    toY - size * Math.sin(angle - Math.PI / 7),
  );
  ctx.lineTo(toX, toY);
  ctx.lineTo(
    toX - size * Math.cos(angle + Math.PI / 7),
    toY - size * Math.sin(angle + Math.PI / 7),
  );
  ctx.stroke();
}
