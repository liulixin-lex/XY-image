import type { BackgroundJob } from "@loomic/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCanvasSavePayload } from "../src/lib/canvas-save";
import { readGenerator } from "../src/lib/node-canvas/generator";
import {
  GeneratorRuntime,
  type RuntimeApi,
  composePrompt,
  generatorInputs,
} from "../src/lib/node-canvas/runtime";
import { NodeCanvasStore } from "../src/lib/node-canvas/store";
import type { SceneElement } from "../src/lib/node-canvas/types";

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

const prompt = el("p1", "prompt", { text: "雨夜的霓虹街道", width: 240 });
const generator = el("gen1", "generator", {
  x: 300,
  width: 296,
  height: 360,
  customData: {
    generator: {
      model: "gpt-image-2",
      aspectRatio: "1:1",
      count: 2,
      prompt: "电影感",
    },
  },
});
const reference = el("ref1", "image", { y: 200, fileId: "f1" });
const link = (id: string, from: string, to: string) =>
  el(id, "arrow", {
    points: [
      [0, 0],
      [10, 0],
    ],
    startBinding: { elementId: from, focus: 0, gap: 4 },
    endBinding: { elementId: to, focus: 0, gap: 4 },
  });

function makeStore(
  elements: SceneElement[],
  files: Record<string, Record<string, unknown>> = {},
) {
  return new NodeCanvasStore("canvas-1", {
    elements,
    appState: { viewBackgroundColor: "#fff" },
    files,
  });
}

describe("node canvas store", () => {
  it("a drag is one undo step and one new version, saved once it ends", () => {
    const store = makeStore([prompt]);
    store.onNodesChange([
      { type: "position", id: "p1", position: { x: 10, y: 0 }, dragging: true },
    ]);
    store.onNodesChange([
      { type: "position", id: "p1", position: { x: 40, y: 5 }, dragging: true },
    ]);
    expect(store.getState().saveStatus).toBe("dirty");
    store.onNodesChange([{ type: "position", id: "p1", dragging: false }]);
    expect(store.element("p1")).toMatchObject({ x: 40, y: 5, version: 2 });
    expect(store.getState().canUndo).toBe(true);
    store.undo();
    expect(store.liveElements().find((e) => e.id === "p1")).toMatchObject({
      x: 0,
      y: 0,
      version: 3,
    });
    store.redo();
    expect(store.liveElements().find((e) => e.id === "p1")).toMatchObject({
      x: 40,
      y: 5,
    });
  });

  it("selecting and measuring are not changes to save", () => {
    const store = makeStore([prompt]);
    store.onNodesChange([{ type: "select", id: "p1", selected: true }]);
    store.onNodesChange([
      { type: "dimensions", id: "p1", dimensions: { width: 240, height: 130 } },
    ]);
    expect(store.getState().saveStatus).toBe("saved");
    expect(store.getState().revision).toBe(0);
    expect(store.selectedNodes().map((n) => n.id)).toEqual(["p1"]);
  });

  it("connects two nodes with a bound arrow and refuses loops and repeats", () => {
    const store = makeStore([prompt, generator]);
    expect(
      store.isValidConnection({
        source: "p1",
        target: "p1",
        sourceHandle: null,
        targetHandle: null,
      }),
    ).toBe(false);
    store.onConnect({
      source: "p1",
      target: "gen1",
      sourceHandle: null,
      targetHandle: null,
    });
    const [edge] = store.scene.edges;
    expect(edge).toMatchObject({ source: "p1", target: "gen1" });
    expect(edge?.data?.el).toMatchObject({
      type: "arrow",
      startBinding: { elementId: "p1" },
      endBinding: { elementId: "gen1" },
    });
    expect(
      store.isValidConnection({
        source: "p1",
        target: "gen1",
        sourceHandle: null,
        targetHandle: null,
      }),
    ).toBe(false);
  });

  it("deleting a node deletes its edges; a deleted placed picture goes as an id", () => {
    const placed = el("img1", "image", {
      x: 700,
      fileId: "f9",
      customData: { jobId: "job-1" },
    });
    const store = makeStore([generator, placed, link("e1", "gen1", "img1")]);
    store.removeElements(["img1"]);
    expect(store.scene.edges).toEqual([]);
    const payload = buildCanvasSavePayload(
      "canvas-1",
      store.elements(),
      store.appState,
      store.files,
    );
    expect(payload.content.elements.map((e) => e.id)).toEqual(["gen1"]);
    expect(payload.deletedElementIds).toEqual(["img1"]);
    store.undo();
    expect(store.scene.nodes.map((n) => n.id).sort()).toEqual(["gen1", "img1"]);
    expect(store.scene.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("duplicates nodes with the edges between them, without runs or jobIds", () => {
    const running = el("gen1", "generator", {
      ...generator,
      customData: {
        generator: {
          ...readGenerator(generator),
          run: {
            batchId: "b",
            jobs: [
              {
                jobId: "job-1",
                slot: { x: 700, y: 0, width: 280, height: 280 },
              },
            ],
            startedAt: 1,
          },
        },
      },
    });
    const store = makeStore([prompt, running, link("e1", "p1", "gen1")]);
    store.select(["p1", "gen1"]);
    store.duplicateSelection();
    const copies = store.selectedNodes();
    expect(copies).toHaveLength(2);
    const copy = copies.find((n) => n.type === "generator");
    expect(copy && readGenerator(copy.data.el).run).toBeUndefined();
    expect(copy?.data.el).toMatchObject({ x: 332, y: 32, version: 1 });
    expect(store.scene.edges).toHaveLength(2);
  });

  it("shows unplaced pictures of a run as pending, and drops them when they arrive", () => {
    const slot = { x: 700, y: 0, width: 280, height: 280 };
    const running = el("gen1", "generator", {
      ...generator,
      customData: {
        generator: {
          ...readGenerator(generator),
          run: { batchId: "b", jobs: [{ jobId: "job-1", slot }], startedAt: 1 },
        },
      },
    });
    const store = makeStore([running]);
    expect(store.scene.nodes.map((n) => n.type)).toEqual([
      "generator",
      "pending",
    ]);
    // Pending pictures are never saved.
    expect(store.elements().map((e) => e.id)).toEqual(["gen1"]);
    store.mergeRemote(
      [
        running,
        el("img1", "image", {
          ...slot,
          fileId: "f1",
          customData: { jobId: "job-1" },
        }),
        link("e1", "gen1", "img1"),
      ],
      { f1: { id: "f1", storageUrl: "https://storage.example/f1.png" } },
    );
    expect(store.scene.nodes.map((n) => n.type)).toEqual([
      "generator",
      "image",
    ]);
    expect(store.files.f1?.storageUrl).toBe("https://storage.example/f1.png");
    // The server's copy is not a change of the user's.
    expect(store.getState().saveStatus).toBe("saved");
    expect(store.getState().canUndo).toBe(false);
  });

  it("a text edit is a single undo step", () => {
    const store = makeStore([prompt]);
    store.beginEdit();
    for (const text of ["雨", "雨夜", "雨夜街道"])
      store.updateElement(
        "p1",
        (e) => ({ ...e, text, version: (e.version ?? 1) + 1 }),
        { record: false },
      );
    store.endEdit();
    store.undo();
    expect(store.element("p1")?.text).toBe("雨夜的霓虹街道");
  });
});

describe("generator inputs", () => {
  it("collects connected prompts and pictures top to bottom", () => {
    const store = makeStore([
      reference,
      prompt,
      el("t1", "text", { y: 400, text: " 加一点雾 " }),
      generator,
      link("e1", "ref1", "gen1"),
      link("e2", "p1", "gen1"),
      link("e3", "t1", "gen1"),
    ]);
    const inputs = generatorInputs(
      store.scene.nodes,
      store.scene.edges,
      "gen1",
    );
    expect(inputs.prompts).toEqual(["雨夜的霓虹街道", "加一点雾"]);
    expect(inputs.images.map((e) => e.id)).toEqual(["ref1"]);
    expect(composePrompt(inputs, " 电影感 ")).toBe(
      "雨夜的霓虹街道\n\n加一点雾\n\n电影感",
    );
  });
});

describe("generator runtime", () => {
  const job = (
    id: string,
    index: number,
    status: BackgroundJob["status"] = "queued",
  ): BackgroundJob =>
    ({
      id,
      job_type: "image_generation",
      status,
      payload: {
        prompt: "x",
        batch_id: "b1",
        batch_index: index,
        batch_size: 2,
      },
      result: null,
      error_code: null,
      error_message: null,
      billing_status: "none",
      created_at: "2026-10-10T00:00:00Z",
      started_at: null,
      completed_at: null,
      canvas_id: "canvas-1",
    }) as unknown as BackgroundJob;

  let api: { [K in keyof RuntimeApi]: ReturnType<typeof vi.fn> };
  let deps: ConstructorParameters<typeof GeneratorRuntime>[1];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    api = {
      createImageBatch: vi.fn(async () => ({
        batch_id: "b1",
        requested: 2,
        jobs: [job("job-1", 0), job("job-2", 1)],
      })),
      fetchJob: vi.fn(async (_token: string, id: string) => ({
        job: job(id, id === "job-1" ? 0 : 1, "succeeded"),
      })),
      cancelJob: vi.fn(),
      uploadFile: vi.fn(async () => ({
        url: "https://storage.example/storage/v1/object/sign/uploads/ref.png",
      })),
    };
    deps = {
      getToken: () => "tok",
      projectId: "project-1",
      api: api as unknown as RuntimeApi,
      onSettled: vi.fn(),
      report: vi.fn(() => null),
      reportCode: vi.fn(),
      requestSync: vi.fn(),
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends one batch with slots and the generator, then shows the pictures pending", async () => {
    const store = makeStore(
      [
        prompt,
        generator,
        reference,
        link("e1", "p1", "gen1"),
        link("e2", "ref1", "gen1"),
      ],
      {
        f1: {
          id: "f1",
          storageUrl:
            "https://storage.example/storage/v1/object/public/canvas/f1.png",
        },
      },
    );
    const runtime = new GeneratorRuntime(store, deps);
    const params = {
      model: "gpt-image-2",
      aspectRatio: "1:1",
      resolution: "2K" as const,
      quality: "auto" as const,
    };
    const sent = runtime.generate("gen1", params);
    // Locked while in flight: a second click sends nothing.
    expect(await runtime.generate("gen1", params)).toBe(false);
    expect(await sent).toBe(true);
    expect(api.createImageBatch).toHaveBeenCalledTimes(1);
    const body = api.createImageBatch.mock.calls[0]?.[1];
    expect(body).toMatchObject({
      prompt: "雨夜的霓虹街道\n\n电影感",
      model: "gpt-image-2",
      count: 2,
      canvas_id: "canvas-1",
      canvas_source_id: "gen1",
      project_id: "project-1",
      input_images: [
        "https://storage.example/storage/v1/object/public/canvas/f1.png",
      ],
    });
    expect(body.canvas_slots).toHaveLength(2);
    expect(
      readGenerator(store.element("gen1") as SceneElement).run?.jobs.map(
        (j) => j.jobId,
      ),
    ).toEqual(["job-1", "job-2"]);
    expect(store.scene.nodes.filter((n) => n.type === "pending")).toHaveLength(
      2,
    );
  });

  it("uploads a picture that only exists in this page before sending", async () => {
    const store = makeStore(
      [generator, reference, link("e2", "ref1", "gen1")],
      {
        f1: { id: "f1", dataURL: "data:image/png;base64,iVBORw0KGgo=" },
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["png"], { type: "image/png" }))),
    );
    const runtime = new GeneratorRuntime(store, deps);
    await runtime.generate("gen1", {
      model: "m",
      aspectRatio: "1:1",
      resolution: "1K",
      quality: "low",
    });
    expect(api.uploadFile).toHaveBeenCalledTimes(1);
    expect(api.createImageBatch.mock.calls[0]?.[1].input_images).toEqual([
      "https://storage.example/storage/v1/object/sign/uploads/ref.png",
    ]);
    vi.unstubAllGlobals();
  });

  it("a rejected batch sends nothing else and keeps the reason", async () => {
    api.createImageBatch.mockRejectedValueOnce(
      new Error("insufficient_balance"),
    );
    deps.report = vi.fn(
      () =>
        ({
          title: "主站余额不足",
          message: "",
          action: "recharge",
          weight: "dialog",
          maybeCharged: false,
        }) as never,
    );
    const store = makeStore([generator]);
    const runtime = new GeneratorRuntime(store, deps);
    expect(
      await runtime.generate("gen1", {
        model: "m",
        aspectRatio: "1:1",
        resolution: "1K",
        quality: "low",
      }),
    ).toBe(false);
    expect(runtime.getState().errors.get("gen1")?.title).toBe("主站余额不足");
    expect(runtime.getState().sending.size).toBe(0);
    expect(store.scene.nodes.filter((n) => n.type === "pending")).toHaveLength(
      0,
    );
  });

  it("follows pending pictures and fetches the canvas when they finish", async () => {
    const store = makeStore([generator]);
    const runtime = new GeneratorRuntime(store, deps);
    runtime.start();
    await runtime.generate("gen1", {
      model: "m",
      aspectRatio: "1:1",
      resolution: "1K",
      quality: "low",
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(api.fetchJob).toHaveBeenCalledTimes(2);
    expect(deps.requestSync).toHaveBeenCalled();
    // Settled jobs this page sent refresh the balance once each.
    expect(deps.onSettled).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });
});
