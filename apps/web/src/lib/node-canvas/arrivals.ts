/**
 * Pictures that just arrived from the server (a canvas sync): which ones to
 * ring, and which to bring into view. The editor applies it
 * (node-canvas-editor revealArrived); kept pure here so it can be tested
 * without React Flow.
 */
import { jobIdOf } from "./element";
import type { SceneNode } from "./types";

export type Rect = { x: number; y: number; width: number; height: number };

export type ArrivalPlan = {
  /** Every new picture: a ring for a moment. */
  ring: string[];
  /**
   * The design assistant's new pictures, when at least one of them is off
   * screen: brought into view together (or offered with 查看). Empty when
   * they are all visible.
   */
  reveal: string[];
};

/**
 * `fromPending`: job ids whose pending slot was on the canvas before the
 * merge. Those pictures replace their slot where the user watched it, so
 * they are only ringed. A picture counts as on screen when its middle is
 * inside the view, less a margin of 8% of the view's short side.
 */
export function planArrivals(
  nodes: readonly SceneNode[],
  arrivedIds: readonly string[],
  fromPending: ReadonlySet<string>,
  view: Rect | null,
  rectOf: (node: SceneNode) => Rect,
): ArrivalPlan {
  const wanted = new Set(arrivedIds);
  const arrived = nodes.filter(
    (n) => wanted.has(n.id) && (n.type === "image" || n.type === "video"),
  );
  const ring = arrived.map((n) => n.id);
  const fromAssistant = arrived.filter(
    (n) => !fromPending.has(jobIdOf(n.data.el) ?? ""),
  );
  if (fromAssistant.length === 0 || !view) return { ring, reveal: [] };
  const margin = Math.min(view.width, view.height) * 0.08;
  const offScreen = fromAssistant.some((n) => {
    const r = rectOf(n);
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    return (
      cx < view.x + margin ||
      cx > view.x + view.width - margin ||
      cy < view.y + margin ||
      cy > view.y + view.height - margin
    );
  });
  return { ring, reveal: offScreen ? fromAssistant.map((n) => n.id) : [] };
}
