import { describe, expect, it } from "vitest";

import { planArrivals } from "../src/lib/node-canvas/arrivals";
import { placementStatus } from "../src/lib/node-canvas/placement";
import { NodeCanvasStore } from "../src/lib/node-canvas/store";
import type { SceneElement, SceneNode } from "../src/lib/node-canvas/types";

// image.gguuai.com 2026-10-17: the design assistant's pictures landed right
// of everything, off screen, while the chat stamped 「已放到画布」. The page
// now brings such pictures into view, and the stamp follows what the page's
// canvas really holds.

const el = (id: string, type: string, extra: Partial<SceneElement> = {}): SceneElement => ({
  id,
  type,
  x: 0,
  y: 0,
  width: 600,
  height: 400,
  version: 1,
  ...extra,
});

const rectOf = (node: SceneNode) => ({
  x: node.position.x,
  y: node.position.y,
  width: Number(node.data.el.width),
  height: Number(node.data.el.height),
});

function storeWith(elements: SceneElement[]) {
  return new NodeCanvasStore("canvas-1", { elements, appState: {}, files: {} });
}

const view = { x: -500, y: -400, width: 1000, height: 800 };

describe("planArrivals", () => {
  it("brings the assistant's picture into view when it landed off screen", () => {
    const store = storeWith([el("old", "image")]);
    const far = el("img-far", "image", { x: 5112, y: -169, fileId: "f1", customData: { jobId: "job-1" } });
    const { added } = store.mergeRemote([far]);
    expect(planArrivals(store.scene.nodes, added, new Set(), view, rectOf)).toEqual({
      ring: ["img-far"],
      reveal: ["img-far"],
    });
  });

  it("only rings a picture that landed where the user is looking", () => {
    const store = storeWith([]);
    const near = el("img-near", "image", { x: -300, y: -200, fileId: "f1", customData: { jobId: "job-1" } });
    const { added } = store.mergeRemote([near]);
    expect(planArrivals(store.scene.nodes, added, new Set(), view, rectOf)).toEqual({
      ring: ["img-near"],
      reveal: [],
    });
  });

  it("does not move the view for a generator's own pictures, which fill their pending slots", () => {
    const generator = el("gen1", "generator", {
      width: 296,
      height: 360,
      customData: {
        generator: {
          model: "gpt-image-2",
          aspectRatio: "1:1",
          count: 1,
          prompt: "猫",
          run: {
            batchId: "b1",
            startedAt: 1,
            jobs: [{ jobId: "job-9", slot: { x: 4000, y: 0, width: 280, height: 280 } }],
          },
        },
      },
    });
    const store = storeWith([generator]);
    // As the editor does: the pending slots before the merge.
    const fromPending = new Set(
      store.scene.nodes.flatMap((n) =>
        n.type === "pending" && n.data.pending?.jobId ? [n.data.pending.jobId] : [],
      ),
    );
    expect(fromPending.has("job-9")).toBe(true);
    const picture = el("img9", "image", {
      x: 4000,
      width: 280,
      height: 280,
      fileId: "f9",
      customData: { jobId: "job-9" },
    });
    const { added } = store.mergeRemote([generator, picture]);
    expect(planArrivals(store.scene.nodes, added, fromPending, view, rectOf)).toEqual({
      ring: ["img9"],
      reveal: [],
    });
  });

  it("ignores arrivals that are not pictures", () => {
    const store = storeWith([]);
    const { added } = store.mergeRemote([el("p1", "prompt", { x: 9000, text: "hi" })]);
    expect(planArrivals(store.scene.nodes, added, new Set(), view, rectOf)).toEqual({
      ring: [],
      reveal: [],
    });
  });
});

describe("placementStatus", () => {
  it("tells placed, deleted here, and not arrived yet apart", () => {
    const store = storeWith([el("img1", "image", { fileId: "f1" })]);
    expect(placementStatus(store.scene, "img1")).toBe("placed");
    expect(placementStatus(store.scene, "img-later")).toBe("unknown");

    store.removeElements(["img1"]);
    expect(placementStatus(store.scene, "img1")).toBe("removed");

    store.mergeRemote([el("img-later", "image", { fileId: "f2" })]);
    expect(placementStatus(store.scene, "img-later")).toBe("placed");
  });
});
