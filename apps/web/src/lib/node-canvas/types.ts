/**
 * Node canvas scene types.
 *
 * Canvas content keeps its stored shape, `{ elements, appState, files }`, so
 * saves, the server's canvas writer and the design assistant's canvas tools
 * work unchanged. Each element shows as a React Flow node; an arrow bound at
 * both ends shows as an edge. Elements keep every field they were loaded with
 * (`data.el`), so whatever the editor does not understand survives a save.
 */
import type { Edge, Node } from "@xyflow/react";

/** An element as stored in canvas content (Excalidraw-compatible fields). */
export type SceneElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  version?: number;
  versionNonce?: number;
  updated?: number;
  customData?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * A canvas file. Stored files come with `storageUrl` (no data); files added
 * in this page carry `dataURL` until a save stores them.
 */
export type SceneFile = {
  id: string;
  mimeType?: string;
  created?: number;
  dataURL?: string;
  storageUrl?: string;
};

export type SceneFiles = Record<string, SceneFile>;

/** The React Flow node types of the canvas. */
export type SceneNodeKind =
  | "pending"
  | "image"
  | "prompt"
  | "generator"
  | "text"
  | "shape"
  | "line"
  | "frame"
  | "video";

export type ElementNodeData = {
  el: SceneElement;
  /** Text bound to a shape (Excalidraw label), shown inside it. */
  label?: SceneElement;
  /**
   * Line nodes: where the element's origin sits inside the node box. Points
   * can go left of or above the origin, so the box starts at their minimum.
   */
  offset?: { x: number; y: number };
  /**
   * Pending nodes only: a picture of a generator run on its way. They hold
   * its canvas slot, are never saved, and go away once the picture is placed.
   */
  pending?: { jobId: string; generatorId: string };
};

export type SceneNode = Node<ElementNodeData, SceneNodeKind>;

export type EdgeData = {
  el: SceneElement;
  /** Text bound to the arrow, shown on the edge. */
  label?: SceneElement;
};

export type SceneEdge = Edge<EdgeData>;

export type Scene = {
  nodes: SceneNode[];
  edges: SceneEdge[];
  /** Live elements the editor does not show (unknown types); saved as they are. */
  kept: SceneElement[];
  /** Deleted elements: newer than the server's copy until a save lands. */
  deleted: SceneElement[];
};
