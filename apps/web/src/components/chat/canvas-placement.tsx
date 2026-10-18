"use client";

/**
 * The canvas page tells the chat where the design assistant's pictures are:
 * whether one is on this page's canvas yet, and how to bring it into view.
 * Outside a canvas page (no provider) the chat goes by the server's word,
 * as before.
 */
import { createContext, useContext, useSyncExternalStore } from "react";

import type { PlacementStatus } from "../../lib/node-canvas/placement";

export type CanvasPlacement = {
  subscribe: (listener: () => void) => () => void;
  status: (elementId: string) => PlacementStatus;
  /** Selects the element and brings it into view (closing the chat over the canvas on small screens). */
  locate: (elementId: string) => void;
};

const CanvasPlacementContext = createContext<CanvasPlacement | null>(null);

export const CanvasPlacementProvider = CanvasPlacementContext.Provider;

const noSubscription = () => () => {};

/** Where `elementId` stands on this page's canvas, or null outside a canvas page. */
export function useCanvasPlacement(
  elementId: string | undefined,
): { status: PlacementStatus; locate: () => void } | null {
  const placement = useContext(CanvasPlacementContext);
  const status = useSyncExternalStore(
    placement && elementId ? placement.subscribe : noSubscription,
    () => (placement && elementId ? placement.status(elementId) : "unknown"),
    () => "unknown" as const,
  );
  if (!placement || !elementId) return null;
  return { status, locate: () => placement.locate(elementId) };
}
