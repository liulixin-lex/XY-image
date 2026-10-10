/**
 * Merging the server's copy of a canvas into the page's scene.
 *
 * The page may hold edits it has not saved yet, while the server may have
 * elements the page has not seen: pictures the worker placed for a finished
 * job (with their edges) and what the design assistant added or changed. Per
 * element id the higher `version` wins; on a tie the page's copy stays.
 * Elements only the page has are kept (not saved yet), and the page's
 * deletions (tombstones) win over older live copies.
 *
 * Nodes and edges whose element did not change are kept as the same objects,
 * so React Flow keeps their measured size and selection.
 */
import { elementsToScene, sanitizeElement, sceneToElements } from "./adapter";
import { jobIdOf, readNumber } from "./element";
import type { Scene, SceneEdge, SceneElement, SceneNode } from "./types";

export type MergeResult = {
  scene: Scene;
  /** Ids of elements taken from the server copy. */
  added: string[];
  updated: string[];
};

export function mergeRemoteElements(
  scene: Scene,
  remoteRaw: readonly unknown[],
): MergeResult {
  const local = sceneToElements(scene);
  const localById = new Map(local.map((el) => [el.id, el]));
  const taken = new Map<string, SceneElement>();
  const added: string[] = [];
  const updated: string[] = [];
  for (const raw of remoteRaw) {
    const remote = sanitizeElement(raw);
    if (!remote) continue;
    const mine = localById.get(remote.id);
    if (!mine) {
      // A deleted element the page never had is nothing to show.
      if (remote.isDeleted) continue;
      taken.set(remote.id, remote);
      added.push(remote.id);
    } else if (readNumber(remote.version) > readNumber(mine.version)) {
      taken.set(remote.id, remote);
      updated.push(remote.id);
    }
  }
  if (taken.size === 0) return { scene, added, updated };

  const merged = local.map((el) => taken.get(el.id) ?? el);
  for (const id of added) {
    const el = taken.get(id);
    if (el) merged.push(el);
  }
  const next = elementsToScene(merged);
  return {
    scene: {
      ...next,
      nodes: reuseNodes(scene.nodes, next.nodes, taken),
      edges: reuseEdges(scene.edges, next.edges, taken),
    },
    added,
    updated,
  };
}

function reuseNodes(
  previous: SceneNode[],
  next: SceneNode[],
  taken: Map<string, SceneElement>,
): SceneNode[] {
  const byId = new Map(previous.map((node) => [node.id, node]));
  const out = next.map((node) => {
    const prev = byId.get(node.id);
    if (!prev || prev.type !== node.type) return node;
    const labelId = node.data.label?.id;
    const changed =
      taken.has(node.id) || (labelId !== undefined && taken.has(labelId));
    if (!changed && prev.data.label?.id === labelId) return prev;
    // Changed on the server: new data, same measured size and selection.
    return {
      ...node,
      ...(prev.measured ? { measured: prev.measured } : {}),
      ...(prev.selected ? { selected: prev.selected } : {}),
    };
  });
  // Pending pictures are the editor's own, never in the stored content; one
  // goes away when its picture is on the canvas.
  const placed = new Set(out.flatMap((node) => jobIdOf(node.data.el) ?? []));
  const pending = previous.filter(
    (node) =>
      node.type === "pending" && !placed.has(node.data.pending?.jobId ?? ""),
  );
  return [...out, ...pending];
}

function reuseEdges(
  previous: SceneEdge[],
  next: SceneEdge[],
  taken: Map<string, SceneElement>,
): SceneEdge[] {
  const byId = new Map(previous.map((edge) => [edge.id, edge]));
  return next.map((edge) => {
    const prev = byId.get(edge.id);
    if (!prev) return edge;
    const labelId = edge.data?.label?.id;
    const changed =
      taken.has(edge.id) ||
      (labelId !== undefined && taken.has(labelId)) ||
      prev.source !== edge.source ||
      prev.target !== edge.target;
    if (!changed && prev.data?.label?.id === labelId) return prev;
    return { ...edge, ...(prev.selected ? { selected: prev.selected } : {}) };
  });
}
