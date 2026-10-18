/**
 * Whether an element the server placed (a design assistant picture, by the
 * `elementId` its tool returned) is on this page's canvas: on it, deleted
 * here, or not arrived yet. The chat's 「已放到画布」 stamp and its 查看
 * button go by this, not by the server's word alone: through 0.0.17 the
 * stamp showed over pictures the page had never fetched.
 */
import type { Scene } from "./types";

export type PlacementStatus = "placed" | "removed" | "unknown";

type Index = { live: Set<string>; deleted: Set<string> };

// Per scene object (the store replaces it on every change), so many chat
// cards asking during a drag cost one pass over the scene, not one each.
const indexes = new WeakMap<Scene, Index>();

function indexOf(scene: Scene): Index {
  let index = indexes.get(scene);
  if (!index) {
    index = {
      live: new Set([
        ...scene.nodes.filter((n) => n.type !== "pending").map((n) => n.id),
        ...scene.edges.map((e) => e.id),
      ]),
      deleted: new Set(
        scene.deleted
          .map((el) => el.id)
          .filter((id): id is string => typeof id === "string"),
      ),
    };
    indexes.set(scene, index);
  }
  return index;
}

export function placementStatus(scene: Scene, id: string): PlacementStatus {
  const index = indexOf(scene);
  if (index.live.has(id)) return "placed";
  if (index.deleted.has(id)) return "removed";
  return "unknown";
}
