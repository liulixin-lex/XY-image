"use client";

/**
 * What node components share: the canvas store, the generator runtime and
 * the editor's actions. Nodes read state through selectors so a drag only
 * re-renders what it touches.
 */
import { createContext, useContext, useSyncExternalStore } from "react";

import type {
  GeneratorRuntime,
  RuntimeState,
} from "../../lib/node-canvas/runtime";
import type { NodeCanvasStore, StoreState } from "../../lib/node-canvas/store";

export type NodeCanvasActions = {
  /** A generator right of a picture, fed by it, selected. */
  generateFrom: (imageId: string) => void;
  download: (imageId: string) => void;
};

export type NodeCanvasContextValue = {
  store: NodeCanvasStore;
  runtime: GeneratorRuntime;
  theme: "light" | "dark";
  actions: NodeCanvasActions;
};

const NodeCanvasContext = createContext<NodeCanvasContextValue | null>(null);

export const NodeCanvasProvider = NodeCanvasContext.Provider;

export function useNodeCanvas(): NodeCanvasContextValue {
  const value = useContext(NodeCanvasContext);
  if (!value) throw new Error("useNodeCanvas outside NodeCanvasProvider");
  return value;
}

/** A slice of the store's state; `select` must return stable values. */
export function useStoreState<T>(select: (state: StoreState) => T): T {
  const { store } = useNodeCanvas();
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(store.getState()),
  );
}

export function useRuntimeState<T>(select: (state: RuntimeState) => T): T {
  const { runtime } = useNodeCanvas();
  return useSyncExternalStore(
    runtime.subscribe,
    () => select(runtime.getState()),
    () => select(runtime.getState()),
  );
}
