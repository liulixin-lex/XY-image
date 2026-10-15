/**
 * Where things go on the node canvas: moved to @loomic/shared
 * (packages/shared/src/canvas-layout.ts) in 第 69 条 so the design
 * assistant's workflow tools place nodes and pictures the way the page does.
 */
export {
  OUTPUT_GAP,
  OUTPUT_LONG_EDGE,
  OUTPUT_OFFSET,
  type Rect,
  boundsOf,
  freeSpotNear,
  outputSize,
  outputSlots,
  overlaps,
  rightOfEverything,
} from "@loomic/shared";
