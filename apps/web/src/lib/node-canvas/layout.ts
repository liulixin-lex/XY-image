/**
 * Where things go on the node canvas.
 *
 * A generator's pictures get their canvas slots before the request is sent:
 * the worker places each finished picture in its slot (server
 * canvas-element-writer), so they land where the page showed them pending,
 * even if the page was closed meanwhile. Slots form a grid right of the
 * generator, one row lower for each run that would overlap something.
 */
import { IMAGE_BATCH_MAX, aspectRatioValue } from "@loomic/shared";

export type Rect = { x: number; y: number; width: number; height: number };

/** Long edge of a picture as first shown on the canvas. */
export const OUTPUT_LONG_EDGE = 280;
/** Room for the edge between a generator and its first column. */
export const OUTPUT_OFFSET = 96;
export const OUTPUT_GAP = 24;
/** Rows tried below the first before giving up on finding free room. */
const MAX_ROWS = 40;

export function outputSize(aspectRatio: string, longEdge = OUTPUT_LONG_EDGE) {
  const ratio = aspectRatioValue(aspectRatio) ?? 1;
  return ratio >= 1
    ? { width: longEdge, height: Math.round(longEdge / ratio) }
    : { width: Math.round(longEdge * ratio), height: longEdge };
}

export function overlaps(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x < b.x + b.width + margin &&
    a.x + a.width + margin > b.x &&
    a.y < b.y + b.height + margin &&
    a.y + a.height + margin > b.y
  );
}

/**
 * Slots for `count` pictures of `generator`, avoiding `obstacles` (the other
 * nodes; frames and lines should be left out by the caller).
 */
export function outputSlots(
  generator: Rect,
  count: number,
  aspectRatio: string,
  obstacles: readonly Rect[],
): Rect[] {
  const n = Math.min(IMAGE_BATCH_MAX, Math.max(1, Math.round(count)));
  const size = outputSize(aspectRatio);
  const columns = n === 1 ? 1 : 2;
  const rows = Math.ceil(n / columns);
  const gridHeight = rows * size.height + (rows - 1) * OUTPUT_GAP;
  const left = generator.x + generator.width + OUTPUT_OFFSET;
  const centredTop = generator.y + generator.height / 2 - gridHeight / 2;
  // Never above the generator's top when it is the taller one.
  const firstTop = Math.min(centredTop, generator.y);

  const grid = (top: number) =>
    Array.from({ length: n }, (_, i) => ({
      x: left + (i % columns) * (size.width + OUTPUT_GAP),
      y: top + Math.floor(i / columns) * (size.height + OUTPUT_GAP),
      width: size.width,
      height: size.height,
    }));

  let top = firstTop;
  for (let row = 0; row < MAX_ROWS; row++) {
    const slots = grid(top);
    const blocker = findBlocker(slots, obstacles);
    if (!blocker) return slots;
    // Next try starts below whatever was in the way.
    top = Math.max(top + OUTPUT_GAP, blocker.y + blocker.height + OUTPUT_GAP);
  }
  return grid(top);
}

function findBlocker(
  slots: readonly Rect[],
  obstacles: readonly Rect[],
): Rect | null {
  let lowest: Rect | null = null;
  for (const obstacle of obstacles) {
    if (!slots.some((slot) => overlaps(slot, obstacle, OUTPUT_GAP / 2)))
      continue;
    if (!lowest || obstacle.y + obstacle.height > lowest.y + lowest.height)
      lowest = obstacle;
  }
  return lowest;
}

/**
 * A free spot for a new node of `size` near `centre`: the centre itself if
 * free, else the closest free spot on a ring search around it.
 */
export function freeSpotNear(
  centre: { x: number; y: number },
  size: { width: number; height: number },
  obstacles: readonly Rect[],
): { x: number; y: number } {
  const at = (dx: number, dy: number): Rect => ({
    x: centre.x - size.width / 2 + dx,
    y: centre.y - size.height / 2 + dy,
    ...size,
  });
  const free = (rect: Rect) =>
    !obstacles.some((o) => overlaps(rect, o, OUTPUT_GAP));
  const first = at(0, 0);
  if (free(first)) return { x: first.x, y: first.y };
  const stepX = size.width + OUTPUT_GAP;
  const stepY = size.height + OUTPUT_GAP;
  for (let ring = 1; ring <= 12; ring++) {
    const candidates: Rect[] = [];
    for (let i = -ring; i <= ring; i++) {
      candidates.push(
        at(i * stepX, -ring * stepY),
        at(i * stepX, ring * stepY),
      );
      if (Math.abs(i) !== ring)
        candidates.push(
          at(-ring * stepX, i * stepY),
          at(ring * stepX, i * stepY),
        );
    }
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - first.x, a.y - first.y) -
        Math.hypot(b.x - first.x, b.y - first.y),
    );
    const spot = candidates.find(free);
    if (spot) return { x: spot.x, y: spot.y };
  }
  return { x: first.x, y: first.y };
}

/**
 * Right of everything, centred on the rightmost node (how the canvas has
 * always placed pictures without a placement); `fallback` when empty.
 */
export function rightOfEverything(
  rects: readonly Rect[],
  size: { width: number; height: number },
  fallback: { x: number; y: number },
): { x: number; y: number } {
  if (rects.length === 0)
    return { x: fallback.x - size.width / 2, y: fallback.y - size.height / 2 };
  let rightmost = rects[0] as Rect;
  for (const rect of rects) {
    if (rect.x + rect.width > rightmost.x + rightmost.width) rightmost = rect;
  }
  return {
    x: rightmost.x + rightmost.width + 40,
    y: rightmost.y + rightmost.height / 2 - size.height / 2,
  };
}

/** The box around `rects`, or null when there are none. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
