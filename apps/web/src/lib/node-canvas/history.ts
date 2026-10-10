/**
 * Undo / redo for the node canvas.
 *
 * Each entry is one user action: the elements it changed, as they were before
 * and after. Undo puts back only those elements, so pictures the worker placed
 * meanwhile and the design assistant's changes are never undone by the user's
 * undo. Restoring never rolls versions back: a restored element gets the
 * version after its current copy, so it wins merges and the next save; an
 * element the action added is deleted (a tombstone).
 */
import { bumpElement, deleteElement, readNumber } from "./element";
import type { SceneElement } from "./types";

export const HISTORY_LIMIT = 100;

type Entry = {
  /** Per changed id: the live element before / after, undefined = absent. */
  before: Map<string, SceneElement | undefined>;
  after: Map<string, SceneElement | undefined>;
};

function liveById(elements: readonly SceneElement[]) {
  const map = new Map<string, SceneElement>();
  for (const el of elements) if (!el.isDeleted) map.set(el.id, el);
  return map;
}

/** The ids a change touched: added, removed, or given a new version. */
export function diffElements(
  before: readonly SceneElement[],
  after: readonly SceneElement[],
): Entry | null {
  const a = liveById(before);
  const b = liveById(after);
  const entry: Entry = { before: new Map(), after: new Map() };
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const prev = a.get(id);
    const next = b.get(id);
    if (prev && next && readNumber(prev.version) === readNumber(next.version))
      continue;
    entry.before.set(id, prev);
    entry.after.set(id, next);
  }
  return entry.before.size > 0 ? entry : null;
}

export class SceneHistory {
  private past: Entry[] = [];
  private future: Entry[] = [];

  constructor(private readonly limit = HISTORY_LIMIT) {}

  /** Records one action from the elements before and after it. */
  record(
    before: readonly SceneElement[],
    after: readonly SceneElement[],
  ): boolean {
    const entry = diffElements(before, after);
    if (!entry) return false;
    this.past.push(entry);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    return true;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** `current` (deleted included) with the last action undone, or null. */
  undo(current: readonly SceneElement[]): SceneElement[] | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push(entry);
    return applyState(current, entry.before);
  }

  redo(current: readonly SceneElement[]): SceneElement[] | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push(entry);
    return applyState(current, entry.after);
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}

/** `current` with the given ids set to the wanted state, versions moving on. */
function applyState(
  current: readonly SceneElement[],
  wanted: Map<string, SceneElement | undefined>,
): SceneElement[] {
  const seen = new Set<string>();
  const out = current.map((el) => {
    if (!wanted.has(el.id)) return el;
    seen.add(el.id);
    const target = wanted.get(el.id);
    if (!target) return el.isDeleted ? el : deleteElement(el);
    return bumpElement(
      {
        ...target,
        version: Math.max(readNumber(el.version), readNumber(target.version)),
      },
      { isDeleted: false },
    );
  });
  // Wanted back but no longer known at all.
  for (const [id, target] of wanted) {
    if (!seen.has(id) && target)
      out.push(bumpElement(target, { isDeleted: false }));
  }
  return out;
}
