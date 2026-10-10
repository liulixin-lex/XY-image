/**
 * Creating and changing canvas elements.
 *
 * Every change bumps `version` (and a new `versionNonce`): merging the
 * server's copy of the canvas (lib/node-canvas/merge.ts) keeps the newer
 * version of each element, the same rule the design assistant's canvas tools
 * follow when they change an element.
 */
import type { SceneElement } from "./types";

const NONCE_MAX = 2_000_000_000;

function randomInt() {
  return Math.floor(Math.random() * NONCE_MAX);
}

/** A new element id: 20 chars of [a-z0-9], valid as a `canvas_source_id`. */
export function newElementId(): string {
  let id = "";
  while (id.length < 20) id += Math.random().toString(36).slice(2);
  return id.slice(0, 20);
}

/** Fields every stored element has, as the server's writers set them. */
export function createElement(
  type: string,
  geometry: { x: number; y: number; width: number; height: number },
  extra: Partial<SceneElement> = {},
): SceneElement {
  return {
    id: newElementId(),
    type,
    ...geometry,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    boundElements: null,
    index: null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
    ...extra,
  };
}

/** A changed copy of `el` with the next version. */
export function bumpElement(
  el: SceneElement,
  changes: Partial<SceneElement> = {},
): SceneElement {
  return {
    ...el,
    ...changes,
    version: (typeof el.version === "number" ? el.version : 1) + 1,
    versionNonce: randomInt(),
    updated: Date.now(),
  };
}

/** A deleted copy of `el` (a tombstone that wins over older copies). */
export function deleteElement(el: SceneElement): SceneElement {
  return bumpElement(el, { isDeleted: true });
}

export function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** customData.jobId: set by the server's writer on what it placed for a job. */
export function jobIdOf(el: { customData?: unknown }): string | null {
  const jobId = (el.customData as { jobId?: unknown } | undefined)?.jobId;
  return typeof jobId === "string" ? jobId : null;
}
