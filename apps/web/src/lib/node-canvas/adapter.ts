/**
 * Canvas elements ⇄ React Flow nodes and edges.
 *
 * Load: `elementsToScene` turns stored elements into nodes (one per element)
 * and edges (arrows bound at both ends). Text bound to a shape or an arrow
 * becomes its label. Elements the editor cannot show are kept aside and saved
 * as they are; deleted ones stay as tombstones (see merge.ts).
 *
 * Save: `sceneToElements` writes each node's position and size back into its
 * element, keeps every other field, and recomputes `boundElements` from the
 * edges so the design assistant's canvas tools see the same links.
 */
import { isVideoUrl } from "../canvas-elements";
import { bumpElement, readNumber } from "./element";
import {
  GENERATOR_WIDTH,
  isLegacyGenerator,
  migrateLegacyGenerator,
} from "./generator";
import type {
  ElementNodeData,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
  SceneNodeKind,
} from "./types";

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const LINES = new Set(["line", "arrow", "freedraw"]);
const FRAMES = new Set(["frame", "magicframe"]);
const EMBEDS = new Set(["embeddable", "iframe"]);

/** Node kinds sized by their content: no fixed height on the node. */
const AUTO_HEIGHT = new Set<SceneNodeKind>(["prompt", "generator", "text"]);

/** Frames sit below everything else. */
const FRAME_Z = -1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isFiniteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);

/**
 * A stored element with usable id, type and geometry, or null. A valid
 * element comes back as the same object, which lets a merge tell the
 * elements it did not change (merge.ts).
 */
export function sanitizeElement(raw: unknown): SceneElement | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id || typeof raw.type !== "string")
    return null;
  if ([raw.x, raw.y, raw.width, raw.height].every(isFiniteNumber))
    return raw as SceneElement;
  return {
    ...raw,
    id: raw.id,
    type: raw.type,
    x: readNumber(raw.x),
    y: readNumber(raw.y),
    width: readNumber(raw.width),
    height: readNumber(raw.height),
  };
}

export function isVideoElement(el: SceneElement): boolean {
  if (el.customData?.isVideo === true) return true;
  return (
    EMBEDS.has(el.type) &&
    isVideoUrl(typeof el.link === "string" ? el.link : null)
  );
}

/** The node kind an element shows as, or null when the editor cannot show it. */
export function nodeKindOf(el: SceneElement): SceneNodeKind | null {
  if (isVideoElement(el)) return "video";
  if (el.type === "image") return "image";
  if (el.type === "prompt" || el.type === "generator" || el.type === "text")
    return el.type;
  if (SHAPES.has(el.type)) return "shape";
  if (LINES.has(el.type)) return "line";
  if (FRAMES.has(el.type)) return "frame";
  return null;
}

type Point = [number, number];

function readPoints(el: SceneElement): Point[] {
  if (!Array.isArray(el.points)) return [];
  return el.points.flatMap((point): Point[] =>
    Array.isArray(point) &&
    typeof point[0] === "number" &&
    typeof point[1] === "number" &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1])
      ? [[point[0], point[1]]]
      : [],
  );
}

/** The box of a line's points, relative to the element origin. */
export function lineBox(el: SceneElement) {
  const points = readPoints(el);
  if (points.length === 0)
    return {
      minX: 0,
      minY: 0,
      width: Math.max(1, el.width),
      height: Math.max(1, el.height),
    };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  // A flat line still needs a box to grab.
  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function bindingId(binding: unknown): string | null {
  return isRecord(binding) && typeof binding.elementId === "string"
    ? binding.elementId
    : null;
}

/** Builds the node for an element (already known to have `kind`). */
export function elementToNode(
  el: SceneElement,
  kind: SceneNodeKind,
  label?: SceneElement,
): SceneNode {
  const data: ElementNodeData = { el, ...(label ? { label } : {}) };
  if (kind === "line") {
    const box = lineBox(el);
    data.offset = { x: -box.minX, y: -box.minY };
    return {
      id: el.id,
      type: kind,
      position: { x: el.x + box.minX, y: el.y + box.minY },
      width: box.width,
      height: box.height,
      data,
    };
  }
  const node: SceneNode = {
    id: el.id,
    type: kind,
    position: { x: el.x, y: el.y },
    data,
  };
  if (kind === "generator") {
    node.width = Math.max(GENERATOR_WIDTH, el.width);
  } else if (AUTO_HEIGHT.has(kind)) {
    // Prompt cards keep their width; free text sizes itself.
    if (kind === "prompt" && el.width > 0) node.width = el.width;
  } else {
    node.width = Math.max(1, el.width);
    node.height = Math.max(1, el.height);
  }
  if (kind === "frame") node.zIndex = FRAME_Z;
  if (el.locked === true) {
    node.draggable = false;
    node.deletable = false;
  }
  return node;
}

export function arrowToEdge(
  el: SceneElement,
  source: string,
  target: string,
  label?: SceneElement,
): SceneEdge {
  return {
    id: el.id,
    source,
    target,
    type: "flow",
    data: { el, ...(label ? { label } : {}) },
  };
}

export function elementsToScene(raw: readonly unknown[]): Scene {
  // The newest copy of each id wins; corrupt content can repeat ids.
  const byIdAll = new Map<string, SceneElement>();
  for (const item of raw) {
    const el = sanitizeElement(item);
    if (!el) continue;
    const seen = byIdAll.get(el.id);
    if (!seen || readNumber(el.version) >= readNumber(seen.version))
      byIdAll.set(el.id, el);
  }

  const live: SceneElement[] = [];
  const deleted: SceneElement[] = [];
  for (const el of byIdAll.values()) {
    if (el.isDeleted) deleted.push(el);
    else live.push(isLegacyGenerator(el) ? migrateLegacyGenerator(el) : el);
  }
  const byId = new Map(live.map((el) => [el.id, el]));

  // Text bound to a shape or an arrow is that element's label.
  const labels = new Map<string, SceneElement>();
  for (const el of live) {
    if (el.type !== "text" || typeof el.containerId !== "string") continue;
    const container = byId.get(el.containerId);
    if (!container || labels.has(container.id)) continue;
    if (SHAPES.has(container.type) || container.type === "arrow")
      labels.set(container.id, el);
  }
  const labelIds = new Set([...labels.values()].map((el) => el.id));

  const kinds = new Map<string, SceneNodeKind>();
  for (const el of live) {
    if (labelIds.has(el.id) || el.type === "arrow") continue;
    const kind = nodeKindOf(el);
    if (kind) kinds.set(el.id, kind);
  }

  const nodes: SceneNode[] = [];
  const edges: SceneEdge[] = [];
  const kept: SceneElement[] = [];
  for (const el of live) {
    if (labelIds.has(el.id)) continue;
    const label = labels.get(el.id);
    if (el.type === "arrow") {
      const source = bindingId(el.startBinding);
      const target = bindingId(el.endBinding);
      const linkable = (id: string | null): id is string =>
        id !== null && kinds.has(id) && kinds.get(id) !== "line";
      if (linkable(source) && linkable(target) && source !== target) {
        edges.push(arrowToEdge(el, source, target, label));
        continue;
      }
      nodes.push(elementToNode(el, "line", label));
      continue;
    }
    const kind = kinds.get(el.id);
    if (kind) nodes.push(elementToNode(el, kind, label));
    else kept.push(el);
  }
  // Frames render first so their children sit on top.
  nodes.sort((a, b) => Number(b.type === "frame") - Number(a.type === "frame"));
  return { nodes, edges, kept, deleted };
}

/** The node's size as shown: fixed size, else measured, else the element's. */
function nodeSize(node: SceneNode) {
  const el = node.data.el;
  return {
    width: node.width ?? node.measured?.width ?? el.width,
    height: node.height ?? node.measured?.height ?? el.height,
  };
}

/** The element of a node with the node's geometry (same object when unchanged). */
export function nodeToElement(node: SceneNode): SceneElement {
  const el = node.data.el;
  if (node.type === "line") {
    const offset = node.data.offset ?? { x: 0, y: 0 };
    const x = node.position.x + offset.x;
    const y = node.position.y + offset.y;
    return x === el.x && y === el.y ? el : { ...el, x, y };
  }
  const { width, height } = nodeSize(node);
  const geometry = { x: node.position.x, y: node.position.y, width, height };
  return geometry.x === el.x &&
    geometry.y === el.y &&
    geometry.width === el.width &&
    geometry.height === el.height
    ? el
    : { ...el, ...geometry };
}

/**
 * The node with its element brought up to date after a move or resize ends
 * (next version, so the change wins over older copies when merging).
 */
export function commitNodeGeometry(node: SceneNode): SceneNode {
  const el = nodeToElement(node);
  if (el === node.data.el) return node;
  return { ...node, data: { ...node.data, el: bumpElement(el) } };
}

/** A label kept centred in its container. */
function placeLabel(
  label: SceneElement,
  container: SceneElement,
): SceneElement {
  const x = container.x + (container.width - label.width) / 2;
  const y = container.y + (container.height - label.height) / 2;
  return Math.abs(x - label.x) < 0.5 && Math.abs(y - label.y) < 0.5
    ? label
    : { ...label, x, y };
}

type BoundRef = { id: string; type: string };

function sameBound(a: unknown, b: BoundRef[] | null): boolean {
  const left = Array.isArray(a) ? (a as BoundRef[]) : [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  const key = (ref: BoundRef) => `${ref?.type}:${ref?.id}`;
  const set = new Set(left.map(key));
  return right.every((ref) => set.has(key(ref)));
}

/**
 * An arrow's element for its edge. The route follows the nodes it joins (not
 * a change of its own, so no new version); a reconnected edge is re-bound,
 * which is.
 */
function edgeElement(
  edge: SceneEdge,
  byId: Map<string, SceneElement>,
): SceneElement | null {
  const el = edge.data?.el;
  if (!el) return null;
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  if (!source || !target) return null;
  const geometry = edgeGeometry(source, target);
  if (
    bindingId(el.startBinding) !== source.id ||
    bindingId(el.endBinding) !== target.id
  )
    return bumpElement(el, geometry);
  const points = readPoints(el);
  const end = geometry.points[1];
  const sameRoute =
    el.x === geometry.x &&
    el.y === geometry.y &&
    points.length === 2 &&
    points[0]?.[0] === 0 &&
    points[0]?.[1] === 0 &&
    points[1]?.[0] === end[0] &&
    points[1]?.[1] === end[1];
  if (sameRoute) return el;
  // Keep the binding's own fields (focus, gap) as they were.
  return {
    ...el,
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    points: geometry.points,
  };
}

/**
 * An arrow from the right middle of `source` to the left middle of `target`,
 * the way the server's canvas writer draws generator → picture edges.
 */
export function edgeGeometry(
  source: Pick<SceneElement, "id" | "x" | "y" | "width" | "height">,
  target: Pick<SceneElement, "id" | "x" | "y" | "width" | "height">,
) {
  const x = source.x + source.width;
  const y = source.y + source.height / 2;
  const dx = target.x - x;
  const dy = target.y + target.height / 2 - y;
  const binding = (id: string) => ({ elementId: id, focus: 0, gap: 4 });
  return {
    x,
    y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    points: [
      [0, 0],
      [dx, dy],
    ] as [Point, Point],
    startBinding: binding(source.id),
    endBinding: binding(target.id),
  };
}

/**
 * The elements to save, deleted ones included (lib/canvas-save.ts sends the
 * live ones and the ids of deleted placed images).
 */
export function sceneToElements(scene: Scene): SceneElement[] {
  const nodeElements = scene.nodes
    .filter((node) => node.type !== "pending")
    .map((node) => ({ node, el: nodeToElement(node) }));
  const byId = new Map<string, SceneElement>();
  for (const { el } of nodeElements) byId.set(el.id, el);

  const arrows: { el: SceneElement; label?: SceneElement }[] = [];
  for (const edge of scene.edges) {
    const el = edgeElement(edge, byId);
    if (el)
      arrows.push({
        el,
        ...(edge.data?.label ? { label: edge.data.label } : {}),
      });
  }

  // Which arrows and labels each element is bound to.
  const bound = new Map<string, BoundRef[]>();
  const addBound = (id: string, ref: BoundRef) => {
    const list = bound.get(id) ?? [];
    list.push(ref);
    bound.set(id, list);
  };
  for (const { el, label } of arrows) {
    const source = bindingId(el.startBinding);
    const target = bindingId(el.endBinding);
    if (source) addBound(source, { id: el.id, type: "arrow" });
    if (target) addBound(target, { id: el.id, type: "arrow" });
    if (label) addBound(el.id, { id: label.id, type: "text" });
  }
  for (const { node } of nodeElements) {
    if (node.data.label)
      addBound(node.id, { id: node.data.label.id, type: "text" });
  }
  // Line nodes that are arrows keep their own (one-end) bindings.
  const withBound = (el: SceneElement): SceneElement => {
    const refs = bound.get(el.id) ?? null;
    if (sameBound(el.boundElements, refs)) return el;
    if (!refs && (el.boundElements === null || el.boundElements === undefined))
      return el;
    return { ...el, boundElements: refs };
  };

  const out: SceneElement[] = [];
  for (const { node, el } of nodeElements) {
    const element = withBound(el);
    out.push(element);
    if (node.data.label) out.push(placeLabel(node.data.label, element));
  }
  for (const { el, label } of arrows) {
    const element = withBound(el);
    out.push(element);
    if (label) out.push(label);
  }
  out.push(...scene.kept, ...scene.deleted);
  return out;
}
