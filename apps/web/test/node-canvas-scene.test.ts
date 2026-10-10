import { describe, expect, it } from "vitest";

import {
  commitNodeGeometry,
  elementsToScene,
  sceneToElements,
} from "../src/lib/node-canvas/adapter";
import { bumpElement, deleteElement } from "../src/lib/node-canvas/element";
import {
  migrateLegacyGenerator,
  readGenerator,
  updateGenerator,
} from "../src/lib/node-canvas/generator";
import { SceneHistory } from "../src/lib/node-canvas/history";
import {
  freeSpotNear,
  outputSlots,
  overlaps,
} from "../src/lib/node-canvas/layout";
import { mergeRemoteElements } from "../src/lib/node-canvas/merge";
import type { SceneElement, SceneNode } from "../src/lib/node-canvas/types";

const el = (
  id: string,
  type: string,
  extra: Partial<SceneElement> = {},
): SceneElement => ({
  id,
  type,
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  version: 1,
  ...extra,
});

const generator = el("gen1", "generator", {
  x: 300,
  y: 0,
  width: 296,
  height: 360,
  customData: {
    generator: {
      model: "gpt-image-2",
      aspectRatio: "16:9",
      resolution: "2K",
      quality: "high",
      count: 4,
      prompt: "",
    },
  },
});

// What the server's canvas writer adds for a finished generator picture.
const placedImage = el("img1", "image", {
  x: 700,
  y: 0,
  width: 280,
  height: 158,
  fileId: "f1",
  customData: { jobId: "job-1" },
});
const outputEdge = el("edge1", "arrow", {
  x: 596,
  y: 180,
  points: [
    [0, 0],
    [104, -101],
  ],
  startBinding: { elementId: "gen1", focus: 0, gap: 4 },
  endBinding: { elementId: "img1", focus: 0, gap: 4 },
  customData: { edge: "output", jobId: "job-1" },
});

describe("elements ⇄ node canvas scene", () => {
  it("shows each element as a node and a bound arrow as an edge", () => {
    const scene = elementsToScene([
      el("p1", "prompt", { text: "雨夜的霓虹街道", width: 240 }),
      generator,
      placedImage,
      outputEdge,
      el("free", "arrow", {
        points: [
          [0, 0],
          [50, 50],
        ],
        startBinding: null,
        endBinding: null,
      }),
      el("frame1", "frame", { name: "灵感" }),
      el("weird", "laser"),
      el("gone", "rectangle", { isDeleted: true }),
    ]);
    const kinds = Object.fromEntries(
      scene.nodes.map((node) => [node.id, node.type]),
    );
    expect(kinds).toEqual({
      frame1: "frame",
      p1: "prompt",
      gen1: "generator",
      img1: "image",
      free: "line",
    });
    // Frames come first so the rest sits on top.
    expect(scene.nodes[0]?.id).toBe("frame1");
    expect(scene.edges).toEqual([
      expect.objectContaining({ id: "edge1", source: "gen1", target: "img1" }),
    ]);
    expect(scene.kept.map((e) => e.id)).toEqual(["weird"]);
    expect(scene.deleted.map((e) => e.id)).toEqual(["gone"]);
  });

  it("saves every field it loaded, with the node's geometry", () => {
    const original = el("r1", "rectangle", {
      strokeColor: "#e03131",
      customData: { note: "keep me" },
      somethingNew: { nested: true },
    });
    const scene = elementsToScene([original]);
    const moved = {
      ...scene,
      nodes: scene.nodes.map((node) => ({
        ...node,
        position: { x: 40, y: 50 },
        width: 120,
      })),
    };
    const [saved] = sceneToElements(moved);
    expect(saved).toEqual({ ...original, x: 40, y: 50, width: 120 });
    // An untouched scene saves the same objects.
    expect(sceneToElements(scene)[0]).toBe(original);
  });

  it("keeps a shape's label inside it and lists it in boundElements", () => {
    const shape = el("s1", "rectangle", {
      boundElements: [{ id: "t1", type: "text" }],
    });
    const label = el("t1", "text", {
      text: "封面",
      containerId: "s1",
      x: 30,
      y: 30,
      width: 40,
      height: 20,
    });
    const scene = elementsToScene([shape, label]);
    expect(scene.nodes).toHaveLength(1);
    expect(scene.nodes[0]?.data.label?.id).toBe("t1");
    const moved = {
      ...scene,
      nodes: scene.nodes.map((node) => ({
        ...node,
        position: { x: 200, y: 100 },
      })),
    };
    const saved = sceneToElements(moved);
    expect(saved.find((e) => e.id === "t1")).toMatchObject({ x: 230, y: 130 });
    expect(saved.find((e) => e.id === "s1")?.boundElements).toEqual([
      { id: "t1", type: "text" },
    ]);
  });

  it("routes an edge between its nodes and records it on both ends", () => {
    const scene = elementsToScene([generator, placedImage, outputEdge]);
    const moved = {
      ...scene,
      nodes: scene.nodes.map((node) =>
        node.id === "img1" ? { ...node, position: { x: 800, y: 300 } } : node,
      ),
    };
    const saved = sceneToElements(moved);
    const arrow = saved.find((e) => e.id === "edge1");
    // Right middle of the generator to the left middle of the picture.
    expect(arrow).toMatchObject({
      x: 596,
      y: 180,
      points: [
        [0, 0],
        [204, 199],
      ],
    });
    // Following its nodes is not a change of the arrow's own.
    expect(arrow?.version).toBe(1);
    expect(saved.find((e) => e.id === "gen1")?.boundElements).toEqual([
      { id: "edge1", type: "arrow" },
    ]);
    expect(saved.find((e) => e.id === "img1")?.boundElements).toEqual([
      { id: "edge1", type: "arrow" },
    ]);
  });

  it("re-binds an edge connected to another node, with a new version", () => {
    const other = el("img2", "image", { x: 700, y: 400, fileId: "f2" });
    const scene = elementsToScene([generator, placedImage, other, outputEdge]);
    const rewired = {
      ...scene,
      edges: scene.edges.map((edge) => ({ ...edge, target: "img2" })),
    };
    const arrow = sceneToElements(rewired).find((e) => e.id === "edge1");
    expect(arrow?.endBinding).toMatchObject({ elementId: "img2" });
    expect(arrow?.version).toBe(2);
  });

  it("an arrow whose node is gone shows as a plain line", () => {
    const scene = elementsToScene([generator, outputEdge]);
    expect(scene.edges).toEqual([]);
    expect(scene.nodes.find((node) => node.id === "edge1")?.type).toBe("line");
  });

  it("moves a line by its node box, keeping its points", () => {
    const line = el("l1", "line", {
      x: 100,
      y: 100,
      points: [
        [0, 0],
        [-40, 60],
      ],
    });
    const scene = elementsToScene([line]);
    const node = scene.nodes[0] as SceneNode;
    expect(node.position).toEqual({ x: 60, y: 100 });
    expect([node.width, node.height]).toEqual([40, 60]);
    const saved = sceneToElements({
      ...scene,
      nodes: [{ ...node, position: { x: 70, y: 110 } }],
    })[0];
    expect(saved).toMatchObject({
      x: 110,
      y: 110,
      points: [
        [0, 0],
        [-40, 60],
      ],
    });
  });

  it("commits a finished move as a new version", () => {
    const scene = elementsToScene([el("r1", "rectangle")]);
    const node = scene.nodes[0] as SceneNode;
    expect(commitNodeGeometry(node)).toBe(node);
    const committed = commitNodeGeometry({ ...node, position: { x: 5, y: 6 } });
    expect(committed.data.el).toMatchObject({ x: 5, y: 6, version: 2 });
  });

  it("opens an old image-generator placeholder as a generator node", () => {
    const legacy = el("old", "rectangle", {
      width: 400,
      height: 400,
      customData: {
        type: "image-generator",
        status: "error",
        errorMessage: "x",
        prompt: "一只猫",
        model: "nano-banana-pro",
        aspectRatio: "3:4",
        quality: "hd",
        inputImages: ["https://example.com/a.png"],
      },
    });
    const scene = elementsToScene([legacy]);
    expect(scene.nodes[0]?.type).toBe("generator");
    const migrated = scene.nodes[0]?.data.el as SceneElement;
    expect(migrated.version).toBe(2);
    expect(migrated.customData).toEqual({
      inputImages: ["https://example.com/a.png"],
      generator: {
        model: "nano-banana-pro",
        aspectRatio: "3:4",
        resolution: "2K",
        quality: "medium",
        count: 1,
        prompt: "一只猫",
      },
    });
    expect(migrateLegacyGenerator(legacy).id).toBe("old");
  });
});

describe("generator settings", () => {
  it("reads junk as the defaults and keeps counts within a batch", () => {
    const config = readGenerator(
      el("g", "generator", {
        customData: {
          generator: {
            aspectRatio: "7:3",
            resolution: "8K",
            count: 99,
            run: { jobs: [{ jobId: 3 }] },
          },
        },
      }),
    );
    expect(config).toEqual({
      model: "",
      aspectRatio: "1:1",
      resolution: "2K",
      quality: "auto",
      count: 4,
      prompt: "",
    });
  });

  it("stores a run with its slots and clears it", () => {
    const run = {
      batchId: "b1",
      jobs: [{ jobId: "job-1", slot: { x: 1, y: 2, width: 280, height: 280 } }],
      startedAt: 5,
    };
    const started = updateGenerator(generator, { run });
    expect(readGenerator(started).run).toEqual(run);
    expect(started.version).toBe(2);
    expect(
      readGenerator(updateGenerator(started, { run: undefined })).run,
    ).toBeUndefined();
  });
});

describe("merging the server's canvas", () => {
  it("adds what the worker placed and keeps unsaved local edits", () => {
    const scene = elementsToScene([
      generator,
      el("note", "text", { text: "本地", version: 3 }),
    ]);
    const remote = [
      generator,
      el("note", "text", { text: "旧的", version: 2 }),
      placedImage,
      outputEdge,
    ];
    const {
      scene: merged,
      added,
      updated,
    } = mergeRemoteElements(scene, remote);
    expect(added).toEqual(["img1", "edge1"]);
    expect(updated).toEqual([]);
    expect(merged.nodes.find((n) => n.id === "note")?.data.el.text).toBe(
      "本地",
    );
    expect(merged.edges.map((e) => e.id)).toEqual(["edge1"]);
    // Unchanged nodes stay the same objects (measured size, selection).
    expect(merged.nodes.find((n) => n.id === "gen1")).toBe(
      scene.nodes.find((n) => n.id === "gen1"),
    );
  });

  it("takes newer server versions and leaves the scene alone when nothing is newer", () => {
    const scene = elementsToScene([el("r1", "rectangle")]);
    const selected = {
      ...scene,
      nodes: scene.nodes.map((n) => ({ ...n, selected: true })),
    };
    const same = mergeRemoteElements(selected, [el("r1", "rectangle")]);
    expect(same.scene).toBe(selected);
    const moved = mergeRemoteElements(selected, [
      el("r1", "rectangle", { x: 90, version: 2 }),
    ]);
    expect(moved.updated).toEqual(["r1"]);
    expect(moved.scene.nodes[0]).toMatchObject({
      position: { x: 90, y: 0 },
      selected: true,
    });
  });

  it("a local deletion wins over the server's older live copy", () => {
    const scene = elementsToScene([deleteElement(placedImage)]);
    const { scene: merged } = mergeRemoteElements(scene, [placedImage]);
    expect(merged.nodes).toEqual([]);
    expect(merged.deleted.map((e) => e.id)).toEqual(["img1"]);
  });

  it("drops a pending picture once its picture is on the canvas", () => {
    const scene = elementsToScene([generator]);
    const pending: SceneNode = {
      id: "pending:job-1",
      type: "pending",
      position: { x: 700, y: 0 },
      width: 280,
      height: 158,
      data: {
        el: el("pending:job-1", "pending"),
        pending: { jobId: "job-1", generatorId: "gen1" },
      },
    };
    const waiting = { ...scene, nodes: [...scene.nodes, pending] };
    expect(sceneToElements(waiting).map((e) => e.id)).toEqual(["gen1"]);
    const { scene: merged } = mergeRemoteElements(waiting, [
      generator,
      placedImage,
      outputEdge,
    ]);
    expect(merged.nodes.map((n) => n.id)).toEqual(["gen1", "img1"]);
  });
});

describe("undo / redo", () => {
  it("undoes only the user's action, not a picture placed meanwhile", () => {
    const history = new SceneHistory();
    const before = [generator];
    const after = [bumpElement(generator, { x: 500 })];
    expect(history.record(before, after)).toBe(true);
    // The worker's picture arrives after the move.
    const current = [...after, placedImage];
    const undone = history.undo(current) as SceneElement[];
    expect(undone.find((e) => e.id === "gen1")).toMatchObject({
      x: 300,
      version: 3,
    });
    expect(undone.find((e) => e.id === "img1")).toBe(placedImage);
    const redone = history.redo(undone) as SceneElement[];
    expect(redone.find((e) => e.id === "gen1")).toMatchObject({
      x: 500,
      version: 4,
    });
  });

  it("undoing an addition deletes it; undoing a deletion brings it back", () => {
    const history = new SceneHistory();
    const added = el("n1", "prompt", { text: "a" });
    history.record([], [added]);
    const afterUndo = history.undo([added]) as SceneElement[];
    expect(afterUndo[0]).toMatchObject({
      id: "n1",
      isDeleted: true,
      version: 2,
    });

    const h2 = new SceneHistory();
    const tomb = deleteElement(placedImage);
    h2.record([placedImage], [tomb]);
    const back = h2.undo([tomb]) as SceneElement[];
    expect(back[0]).toMatchObject({ id: "img1", isDeleted: false, version: 3 });
  });

  it("ignores no-op actions and caps its length", () => {
    const history = new SceneHistory(2);
    expect(history.record([generator], [generator])).toBe(false);
    let current = [generator];
    for (let i = 0; i < 3; i++) {
      const next = [bumpElement(current[0] as SceneElement, { x: i })];
      history.record(current, next);
      current = next;
    }
    expect(history.undo(current)).not.toBeNull();
    expect(history.undo(current)).not.toBeNull();
    expect(history.undo(current)).toBeNull();
  });
});

describe("output slots", () => {
  const gen = { x: 0, y: 0, width: 296, height: 360 };

  it("puts four 16:9 pictures in a 2×2 grid right of the generator", () => {
    const slots = outputSlots(gen, 4, "16:9", []);
    expect(slots).toHaveLength(4);
    expect(slots[0]).toMatchObject({ x: 392, width: 280, height: 158 });
    expect(slots[1]?.x).toBe(392 + 280 + 24);
    expect(slots[2]?.y).toBe((slots[0]?.y ?? 0) + 158 + 24);
    for (const slot of slots) expect(slot.width).toBeGreaterThanOrEqual(16);
  });

  it("goes below earlier pictures instead of on top of them", () => {
    const first = outputSlots(gen, 2, "1:1", []);
    const second = outputSlots(gen, 2, "1:1", first);
    for (const a of second)
      for (const b of first) expect(overlaps(a, b)).toBe(false);
    expect(second[0]?.y).toBeGreaterThan(first[0]?.y ?? 0);
  });

  it("finds free room near a point", () => {
    const taken = [{ x: -60, y: -60, width: 120, height: 120 }];
    const spot = freeSpotNear(
      { x: 0, y: 0 },
      { width: 100, height: 100 },
      taken,
    );
    expect(
      overlaps({ ...spot, width: 100, height: 100 }, taken[0] as never),
    ).toBe(false);
    expect(
      freeSpotNear({ x: 0, y: 0 }, { width: 100, height: 100 }, []),
    ).toEqual({ x: -50, y: -50 });
  });
});
