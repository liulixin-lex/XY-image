/**
 * The node canvas state, outside React.
 *
 * One store per open canvas: the scene (nodes, edges, kept and deleted
 * elements), the canvas files, undo history and save bookkeeping. React Flow
 * runs controlled from it (useSyncExternalStore), and the canvas page, the
 * panels and the design assistant's hooks read and change the canvas through
 * it instead of reaching into the editor.
 *
 * Every user change goes through `change()`: it bumps the changed elements'
 * versions (merge.ts), records one undo step (history.ts) and marks the
 * canvas dirty so the editor saves it. Merging the server's copy is not a
 * user change: no undo step, no save.
 */
import {
  type Connection,
  type EdgeChange,
  type NodeChange,
  applyEdgeChanges,
  applyNodeChanges,
} from "@xyflow/react";

import {
  commitNodeGeometry,
  edgeGeometry,
  elementsToScene,
  sceneToElements,
} from "./adapter";
import { bumpElement, createElement, deleteElement, jobIdOf } from "./element";
import { type GeneratorJob, readGenerator, updateGenerator } from "./generator";
import { SceneHistory } from "./history";
import { mergeRemoteElements } from "./merge";
import type {
  Scene,
  SceneEdge,
  SceneElement,
  SceneFile,
  SceneFiles,
  SceneNode,
} from "./types";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

export type StoreState = {
  scene: Scene;
  files: SceneFiles;
  saveStatus: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped on every change the server has not seen. */
  revision: number;
};

export type CanvasContent = {
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, Record<string, unknown>>;
};

/** Node kinds an edge can end on. */
const LINKABLE = new Set([
  "image",
  "prompt",
  "generator",
  "text",
  "shape",
  "video",
]);

export const PENDING_PREFIX = "pending-";

function toSceneFiles(
  files: Record<string, Record<string, unknown>>,
): SceneFiles {
  const out: SceneFiles = {};
  for (const [id, raw] of Object.entries(files)) {
    if (!raw || typeof raw !== "object") continue;
    const file: SceneFile = { id: typeof raw.id === "string" ? raw.id : id };
    if (typeof raw.mimeType === "string") file.mimeType = raw.mimeType;
    if (typeof raw.created === "number") file.created = raw.created;
    if (typeof raw.storageUrl === "string" && raw.storageUrl)
      file.storageUrl = raw.storageUrl;
    if (typeof raw.dataURL === "string" && raw.dataURL.startsWith("data:"))
      file.dataURL = raw.dataURL;
    out[id] = file;
  }
  return out;
}

/** A node holding the slot of a picture on its way. */
export function pendingNode(job: GeneratorJob, generatorId: string): SceneNode {
  const id = `${PENDING_PREFIX}${job.jobId}`;
  return {
    id,
    type: "pending",
    position: { x: job.slot.x, y: job.slot.y },
    width: job.slot.width,
    height: job.slot.height,
    draggable: false,
    deletable: false,
    selectable: false,
    connectable: false,
    data: {
      el: { id, type: "pending", ...job.slot },
      pending: { jobId: job.jobId, generatorId },
    },
  };
}

/** Pending nodes for the runs of generators whose pictures are not placed yet. */
export function pendingNodesFor(nodes: readonly SceneNode[]): SceneNode[] {
  const placed = new Set<string>();
  for (const node of nodes) {
    const jobId = node.type === "image" ? jobIdOf(node.data.el) : null;
    if (jobId) placed.add(jobId);
  }
  const out: SceneNode[] = [];
  for (const node of nodes) {
    if (node.type !== "generator") continue;
    for (const job of readGenerator(node.data.el).run?.jobs ?? []) {
      if (!placed.has(job.jobId)) out.push(pendingNode(job, node.id));
    }
  }
  return out;
}

export class NodeCanvasStore {
  readonly canvasId: string;
  /** Saved as loaded (background colour, grid); the editor does not change it. */
  readonly appState: Record<string, unknown>;
  /** Live elements the canvas opened with; a save of none is refused (see editor). */
  readonly initialCount: number;
  private state: StoreState;
  private readonly listeners = new Set<() => void>();
  private readonly history = new SceneHistory();
  /** Elements before the drag, resize or text edit in progress. */
  private gestureBefore: SceneElement[] | null = null;
  private elementsCache: { scene: Scene; elements: SceneElement[] } | null =
    null;

  constructor(canvasId: string, content: CanvasContent) {
    this.canvasId = canvasId;
    this.appState = content.appState ?? {};
    const scene = elementsToScene(content.elements ?? []);
    scene.nodes = [...scene.nodes, ...pendingNodesFor(scene.nodes)];
    this.initialCount =
      scene.nodes.length + scene.edges.length + scene.kept.length;
    this.state = {
      scene,
      files: toSceneFiles(content.files ?? {}),
      saveStatus: "saved",
      canUndo: false,
      canRedo: false,
      revision: 0,
    };
  }

  // ── subscription ────────────────────────────────────────────────────

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  private set(patch: Partial<StoreState>) {
    this.state = {
      ...this.state,
      ...patch,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    };
    for (const listener of this.listeners) listener();
  }

  // ── reading ─────────────────────────────────────────────────────────

  get scene() {
    return this.state.scene;
  }

  get files() {
    return this.state.files;
  }

  /** The elements to save, deleted ones included. */
  elements(): SceneElement[] {
    const { scene } = this.state;
    if (this.elementsCache?.scene !== scene)
      this.elementsCache = { scene, elements: sceneToElements(scene) };
    return this.elementsCache.elements;
  }

  liveElements(): SceneElement[] {
    return this.elements().filter((el) => !el.isDeleted);
  }

  element(id: string): SceneElement | null {
    const node = this.state.scene.nodes.find((n) => n.id === id);
    if (node) return node.data.el;
    return this.state.scene.edges.find((e) => e.id === id)?.data?.el ?? null;
  }

  selectedNodes(): SceneNode[] {
    return this.state.scene.nodes.filter(
      (n) => n.selected && n.type !== "pending",
    );
  }

  // ── user changes ────────────────────────────────────────────────────

  /**
   * Applies a user change: `next` scene, one undo step from `before` (the
   * elements before the change), dirty.
   */
  private change(next: Scene, before: SceneElement[] | null = this.elements()) {
    const prevScene = this.state.scene;
    this.state = { ...this.state, scene: next };
    const after = this.elements();
    if (before) this.history.record(before, after);
    if (prevScene === next) return;
    this.set({ saveStatus: "dirty", revision: this.state.revision + 1 });
  }

  onNodesChange = (changes: NodeChange<SceneNode>[]) => {
    const removed = changes.flatMap((c) => (c.type === "remove" ? [c.id] : []));
    const rest = changes.filter((c) => c.type !== "remove");
    if (removed.length) this.removeElements(removed);
    if (rest.length === 0) return;

    const starts = rest.some(
      (c) =>
        (c.type === "position" && c.dragging === true) ||
        (c.type === "dimensions" && c.resizing === true),
    );
    const ends = rest.flatMap((c) =>
      (c.type === "position" && c.dragging === false) ||
      (c.type === "dimensions" && c.resizing === false)
        ? [c.id]
        : [],
    );
    if (starts && !this.gestureBefore) this.gestureBefore = this.elements();
    const before = this.gestureBefore ?? this.elements();

    let nodes = applyNodeChanges(rest, this.state.scene.nodes);
    if (ends.length) {
      const ended = new Set(ends);
      nodes = nodes.map((node) =>
        ended.has(node.id) ? commitNodeGeometry(node) : node,
      );
      this.gestureBefore = null;
      this.change({ ...this.state.scene, nodes }, before);
      return;
    }
    // Mid-gesture, selection and measuring: shown, not yet a change.
    const moved = rest.some(
      (c) =>
        c.type === "position" ||
        (c.type === "dimensions" && c.resizing !== undefined),
    );
    this.state = { ...this.state, scene: { ...this.state.scene, nodes } };
    this.set(
      moved ? { saveStatus: "dirty", revision: this.state.revision + 1 } : {},
    );
  };

  onEdgesChange = (changes: EdgeChange<SceneEdge>[]) => {
    const removed = changes.flatMap((c) => (c.type === "remove" ? [c.id] : []));
    const rest = changes.filter((c) => c.type !== "remove");
    if (removed.length) this.removeElements(removed);
    if (rest.length === 0) return;
    this.state = {
      ...this.state,
      scene: {
        ...this.state.scene,
        edges: applyEdgeChanges(rest, this.state.scene.edges),
      },
    };
    this.set({});
  };

  isValidConnection = (connection: Connection | SceneEdge): boolean => {
    const { source, target } = connection;
    if (!source || !target || source === target) return false;
    const { nodes, edges } = this.state.scene;
    const kinds = new Map(nodes.map((n) => [n.id, n.type]));
    if (
      !LINKABLE.has(kinds.get(source) ?? "") ||
      !LINKABLE.has(kinds.get(target) ?? "")
    )
      return false;
    return !edges.some((e) => e.source === source && e.target === target);
  };

  /** A new edge from the user: an arrow bound at both ends. */
  onConnect = (connection: Connection) => {
    if (!this.isValidConnection(connection)) return;
    this.connect(connection.source, connection.target);
  };

  connect(
    source: string,
    target: string,
    extra: Partial<SceneElement> = {},
  ): string | null {
    const els = new Map(this.liveElements().map((el) => [el.id, el]));
    const from = els.get(source);
    const to = els.get(target);
    if (!from || !to) return null;
    const geometry = edgeGeometry(from, to);
    const arrow = createElement("arrow", geometry, {
      ...geometry,
      startArrowhead: null,
      endArrowhead: "arrow",
      ...extra,
    });
    const edge: SceneEdge = {
      id: arrow.id,
      source,
      target,
      type: "flow",
      data: { el: arrow },
    };
    this.change({
      ...this.state.scene,
      edges: [...this.state.scene.edges, edge],
    });
    console.info(`[node-canvas] connected ${source} → ${target}`);
    return arrow.id;
  }

  /** Deletes nodes and edges (and edges left without a node) as tombstones. */
  removeElements(ids: readonly string[]) {
    const { scene } = this.state;
    const gone = new Set(ids);
    const nodes: SceneNode[] = [];
    const deleted: SceneElement[] = [];
    for (const node of scene.nodes) {
      if (
        !gone.has(node.id) ||
        node.type === "pending" ||
        node.deletable === false
      ) {
        nodes.push(node);
        continue;
      }
      deleted.push(deleteElement(node.data.el));
      if (node.data.label) deleted.push(deleteElement(node.data.label));
    }
    if (deleted.length) {
      // A deleted generator's pictures still arrive (the worker places them
      // without an edge); they just stop being shown as pending here.
      const generators = new Set(deleted.map((el) => el.id));
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i] as SceneNode;
        if (
          node.type === "pending" &&
          generators.has(node.data.pending?.generatorId ?? "")
        )
          nodes.splice(i, 1);
      }
    }
    const live = new Set(nodes.map((n) => n.id));
    const edges: SceneEdge[] = [];
    for (const edge of scene.edges) {
      const keep =
        !gone.has(edge.id) && live.has(edge.source) && live.has(edge.target);
      if (keep || !edge.data) {
        if (keep) edges.push(edge);
        continue;
      }
      deleted.push(deleteElement(edge.data.el));
      if (edge.data.label) deleted.push(deleteElement(edge.data.label));
    }
    if (deleted.length === 0) return;
    this.change({
      ...scene,
      nodes,
      edges,
      deleted: [...scene.deleted, ...deleted],
    });
    console.info(`[node-canvas] deleted ${deleted.length} element(s)`);
  }

  deleteSelection() {
    const ids = [
      ...this.state.scene.nodes.filter((n) => n.selected).map((n) => n.id),
      ...this.state.scene.edges.filter((e) => e.selected).map((e) => e.id),
    ];
    if (ids.length) this.removeElements(ids);
  }

  /** Replaces one element (its next version); `record: false` inside a text edit. */
  updateElement(
    id: string,
    update: (el: SceneElement) => SceneElement,
    options: { record?: boolean } = {},
  ) {
    const { scene } = this.state;
    const index = scene.nodes.findIndex((n) => n.id === id);
    const node = scene.nodes[index];
    if (!node) return;
    const el = update(node.data.el);
    if (el === node.data.el) return;
    const nodes = [...scene.nodes];
    nodes[index] = { ...node, data: { ...node.data, el } };
    const record = options.record ?? true;
    this.change({ ...scene, nodes }, record ? this.elements() : null);
  }

  /** Locks or unlocks an element: a locked node can't be dragged or deleted. */
  setLocked(id: string, locked: boolean) {
    const { scene } = this.state;
    const index = scene.nodes.findIndex((n) => n.id === id);
    const node = scene.nodes[index];
    if (!node || node.type === "pending") return;
    if (Boolean(node.data.el.locked) === locked) return;
    const { draggable: _d, deletable: _x, ...rest } = node;
    const el = bumpElement(node.data.el, { locked });
    const nodes = [...scene.nodes];
    nodes[index] = {
      ...rest,
      ...(locked ? { draggable: false, deletable: false } : {}),
      data: { ...node.data, el },
    };
    this.change({ ...scene, nodes });
    console.info(`[node-canvas] ${locked ? "locked" : "unlocked"} ${id}`);
  }

  /** Start of a text edit: the whole edit is one undo step. */
  beginEdit() {
    if (!this.gestureBefore) this.gestureBefore = this.elements();
  }

  endEdit() {
    const before = this.gestureBefore;
    this.gestureBefore = null;
    if (before) {
      this.history.record(before, this.elements());
      this.set({});
    }
  }

  /** Adds new elements (and their files); selects them when asked. */
  addElements(
    elements: SceneElement[],
    options: { files?: SceneFile[]; select?: boolean } = {},
  ) {
    if (options.files?.length) {
      const files = { ...this.state.files };
      for (const file of options.files) files[file.id] = file;
      this.state = { ...this.state, files };
    }
    const before = this.elements();
    const { scene } = mergeRemoteElements(this.state.scene, elements);
    let next = scene;
    if (options.select) {
      const ids = new Set(elements.map((el) => el.id));
      next = {
        ...scene,
        nodes: scene.nodes.map((n) =>
          ids.has(n.id) !== Boolean(n.selected)
            ? { ...n, selected: ids.has(n.id) }
            : n,
        ),
        edges: scene.edges.map((e) =>
          e.selected ? { ...e, selected: false } : e,
        ),
      };
    }
    this.change(next, before);
  }

  /**
   * Copies of the selected nodes, their labels and the edges between them,
   * offset a little. A copied generator starts without a run, and nothing
   * copied keeps a jobId (those belong to the pictures the worker placed).
   */
  duplicateSelection(offset = 32) {
    const selected = this.selectedNodes();
    if (selected.length === 0) return;
    const current = new Map(this.liveElements().map((el) => [el.id, el]));
    const newIds = new Map<string, string>();
    const copies: SceneElement[] = [];
    const fresh = (
      source: SceneElement,
      changes: Partial<SceneElement> = {},
    ) => {
      const base = createElement(source.type, {
        x: source.x + offset,
        y: source.y + offset,
        width: source.width,
        height: source.height,
      });
      const { jobId: _jobId, ...customData } = source.customData ?? {};
      if (source.type === "generator") {
        const { run: _run, ...settings } = readGenerator(source);
        customData.generator = settings;
      }
      return {
        ...source,
        id: base.id,
        x: base.x,
        y: base.y,
        version: base.version,
        versionNonce: base.versionNonce,
        seed: base.seed,
        updated: base.updated,
        boundElements: null,
        ...(source.customData ? { customData } : {}),
        ...changes,
      } as SceneElement;
    };
    for (const node of selected) {
      const source = current.get(node.id);
      if (!source) continue;
      const copy = fresh(source);
      newIds.set(node.id, copy.id);
      copies.push(copy);
      const label = node.data.label
        ? current.get(node.data.label.id)
        : undefined;
      if (label) copies.push(fresh(label, { containerId: copy.id }));
    }
    for (const edge of this.state.scene.edges) {
      const from = copies.find((c) => c.id === newIds.get(edge.source));
      const to = copies.find((c) => c.id === newIds.get(edge.target));
      if (!from || !to) continue;
      const geometry = edgeGeometry(from, to);
      copies.push(
        createElement("arrow", geometry, {
          ...geometry,
          startArrowhead: null,
          endArrowhead: "arrow",
        }),
      );
    }
    this.addElements(copies, { select: true });
    console.info(`[node-canvas] duplicated ${selected.length} node(s)`);
  }

  undo() {
    this.restore(this.history.undo(this.elements()), "undo");
  }

  redo() {
    this.restore(this.history.redo(this.elements()), "redo");
  }

  private restore(elements: SceneElement[] | null, what: string) {
    if (!elements) return;
    this.gestureBefore = null;
    const { scene } = mergeRemoteElements(this.state.scene, elements);
    this.change(withPending(scene), null);
    console.info(`[node-canvas] ${what}`);
  }

  // ── selection ───────────────────────────────────────────────────────

  select(ids: readonly string[]) {
    const wanted = new Set(ids);
    const { scene } = this.state;
    this.state = {
      ...this.state,
      scene: {
        ...scene,
        nodes: scene.nodes.map((n) =>
          wanted.has(n.id) !== Boolean(n.selected)
            ? { ...n, selected: wanted.has(n.id) }
            : n,
        ),
        edges: scene.edges.map((e) =>
          wanted.has(e.id) !== Boolean(e.selected)
            ? { ...e, selected: wanted.has(e.id) }
            : e,
        ),
      },
    };
    this.set({});
  }

  // ── generator runs ──────────────────────────────────────────────────

  /** Shows the pictures of a new run as pending in their slots. */
  showPending(generatorId: string, jobs: readonly GeneratorJob[]) {
    const nodes = [
      ...this.state.scene.nodes,
      ...jobs.map((job) => pendingNode(job, generatorId)),
    ];
    this.state = { ...this.state, scene: { ...this.state.scene, nodes } };
    this.set({});
  }

  /** Drops jobs from a generator's run (failed pictures the user dismissed). */
  dismissJobs(generatorId: string, jobIds: readonly string[]) {
    const gone = new Set(jobIds);
    const { scene } = this.state;
    const nodes = scene.nodes.filter(
      (n) => !(n.type === "pending" && gone.has(n.data.pending?.jobId ?? "")),
    );
    this.state = { ...this.state, scene: { ...scene, nodes } };
    this.updateElement(
      generatorId,
      (el) => {
        const run = readGenerator(el).run;
        if (!run) return el;
        const jobs = run.jobs.filter((job) => !gone.has(job.jobId));
        return updateGenerator(el, {
          run: jobs.length ? { ...run, jobs } : undefined,
        });
      },
      { record: false },
    );
  }

  // ── server copy ─────────────────────────────────────────────────────

  /**
   * Merges the server's copy (canvas sync): files the page does not have
   * are added, newer elements win (merge.ts). Not an undo step or a change
   * to save.
   */
  mergeRemote(
    elements: readonly unknown[],
    files: Record<string, Record<string, unknown>> = {},
  ) {
    const incoming = toSceneFiles(files);
    const absent = Object.keys(incoming).filter((id) => !this.state.files[id]);
    const merged = mergeRemoteElements(this.state.scene, elements);
    if (absent.length === 0 && merged.scene === this.state.scene) return merged;
    const nextFiles = absent.length
      ? {
          ...this.state.files,
          ...Object.fromEntries(
            absent.map((id) => [id, incoming[id] as SceneFile]),
          ),
        }
      : this.state.files;
    this.state = {
      ...this.state,
      files: nextFiles,
      scene: withPending(merged.scene),
    };
    this.set({});
    if (merged.added.length || merged.updated.length)
      console.info(
        `[node-canvas] merged server copy: ${merged.added.length} added, ${merged.updated.length} updated`,
      );
    return merged;
  }

  // ── files ───────────────────────────────────────────────────────────

  /** A stored copy of a file the page added (its URL after upload). */
  setFileStorageUrl(fileId: string, storageUrl: string) {
    const file = this.state.files[fileId];
    if (!file || file.storageUrl === storageUrl) return;
    this.state = {
      ...this.state,
      files: { ...this.state.files, [fileId]: { ...file, storageUrl } },
    };
    this.set({});
  }

  // ── saving ──────────────────────────────────────────────────────────

  get revision() {
    return this.state.revision;
  }

  setSaveStatus(status: SaveStatus) {
    if (this.state.saveStatus !== status) this.set({ saveStatus: status });
  }

  /** A save of `revision` landed. */
  markSaved(revision: number) {
    this.set({
      saveStatus: this.state.revision === revision ? "saved" : "dirty",
    });
  }
}

/** Pending nodes kept in step with the runs after the scene was rebuilt. */
function withPending(scene: Scene): Scene {
  const real = scene.nodes.filter((n) => n.type !== "pending");
  const existing = new Map(
    scene.nodes.filter((n) => n.type === "pending").map((n) => [n.id, n]),
  );
  const pending = pendingNodesFor(real).map((n) => existing.get(n.id) ?? n);
  return { ...scene, nodes: [...real, ...pending] };
}
