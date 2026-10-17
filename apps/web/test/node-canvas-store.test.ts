import type { BackgroundJob } from "@loomic/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCanvasSavePayload } from "../src/lib/canvas-save";
import { readGenerator } from "../src/lib/node-canvas/generator";
import { planGenerator } from "../src/lib/node-canvas/generator-plan";
import {
  GeneratorRuntime,
  type RuntimeApi,
  composePrompt,
  generatorInputs,
} from "../src/lib/node-canvas/runtime";
import { NodeCanvasStore, reaches } from "../src/lib/node-canvas/store";
import type { ImageModelInfo } from "../src/lib/server-api";
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
  it("links a picture that arrived to its generator when the worker could not", () => {
    const running = el("gen1", "generator", {
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
            jobs: [
              {
                jobId: "job-1",
                slot: { x: 400, y: 0, width: 280, height: 280 },
              },
            ],
          },
        },
      },
    });
    const store = makeStore([running]);
    const picture = el("img1", "image", {
      x: 400,
      width: 280,
      height: 280,
      fileId: "f9",
      customData: { jobId: "job-1" },
    });
    // The worker placed it without an edge (the generator was not saved yet).
    store.mergeRemote([running, picture]);
    const edge = store.scene.edges.find(
      (e) => e.source === "gen1" && e.target === "img1",
    );
    expect(edge?.data?.el.customData).toMatchObject({
      edge: "output",
      jobId: "job-1",
    });
    expect(store.getState()).toMatchObject({
      saveStatus: "dirty",
      canUndo: false,
    });

    // An edge the user deletes later is not brought back by the next merge.
    store.removeElements([edge?.id ?? ""]);
    store.mergeRemote([running, picture]);
    expect(
      store.scene.edges.some((e) => e.source === "gen1" && e.target === "img1"),
    ).toBe(false);
  });

  it("does not add a second edge when the worker linked the picture", () => {
    const running = el("gen1", "generator", {
      customData: {
        generator: {
          count: 1,
          run: {
            batchId: "b1",
            startedAt: 1,
            jobs: [
              {
                jobId: "job-1",
                slot: { x: 400, y: 0, width: 280, height: 280 },
              },
            ],
          },
        },
      },
    });
    const store = makeStore([running]);
    const picture = el("img1", "image", {
      x: 400,
      fileId: "f9",
      customData: { jobId: "job-1" },
    });
    store.mergeRemote([running, picture, link("a1", "gen1", "img1")]);
    expect(
      store.scene.edges.filter(
        (e) => e.source === "gen1" && e.target === "img1",
      ),
    ).toHaveLength(1);
    expect(store.getState().saveStatus).toBe("saved");
  });

  it("counts every fetched server copy, without making the page dirty", () => {
    const store = makeStore([prompt]);
    store.mergeRemote([prompt]);
    expect(store.getState()).toMatchObject({
      remoteSyncs: 1,
      revision: 0,
      saveStatus: "saved",
    });
    store.mergeRemote([prompt, { ...reference, version: 1 }]);
    expect(store.getState()).toMatchObject({
      remoteSyncs: 2,
      revision: 0,
      saveStatus: "saved",
    });
    expect(store.element("ref1")).toBeDefined();
  });

  it("a locked node can't be dragged or deleted, and unlocking is undoable", () => {
    const store = makeStore([prompt, reference]);
    store.setLocked("ref1", true);
    const node = store.scene.nodes.find((n) => n.id === "ref1");
    expect(node).toMatchObject({ draggable: false, deletable: false });
    expect(store.element("ref1")).toMatchObject({ locked: true, version: 2 });

    store.removeElements(["ref1"]);
    expect(store.element("ref1")?.isDeleted).not.toBe(true);

    store.setLocked("ref1", false);
    const unlocked = store.scene.nodes.find((n) => n.id === "ref1");
    expect(unlocked?.draggable).toBeUndefined();
    expect(unlocked?.deletable).toBeUndefined();
    store.undo();
    expect(store.scene.nodes.find((n) => n.id === "ref1")).toMatchObject({
      draggable: false,
      deletable: false,
    });
  });

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

  it("refuses a connection that would close a loop (第 56 条)", () => {
    const second = el("gen2", "generator", { x: 800, width: 296, height: 360 });
    const store = makeStore([
      prompt,
      generator,
      second,
      link("e1", "p1", "gen1"),
      link("e2", "gen1", "gen2"),
    ]);
    expect(reaches(store.scene.edges, "p1", "gen2")).toBe(true);
    const back = { source: "gen2", target: "p1", sourceHandle: null, targetHandle: null };
    expect(store.isValidConnection(back)).toBe(false);
    expect(
      store.isValidConnection({ source: "gen2", target: "gen1", sourceHandle: null, targetHandle: null }),
    ).toBe(false);
    store.onConnect(back);
    expect(store.scene.edges).toHaveLength(2);
  });

  it("断开: removes one edge as a tombstone, one undo step", () => {
    const store = makeStore([prompt, generator, link("e1", "p1", "gen1")]);
    store.disconnect("e1");
    expect(store.scene.edges).toEqual([]);
    expect(store.getState().saveStatus).toBe("dirty");
    store.undo();
    expect(store.scene.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("moves an edge end to another node and keeps the same arrow", () => {
    const other = el("p2", "prompt", { y: 300, text: "海边" });
    const store = makeStore([prompt, other, generator, link("e1", "p1", "gen1")]);
    store.beginReconnect("e1");
    // Dropped back where it was: allowed, and nothing changes.
    expect(
      store.isValidConnection({ source: "p1", target: "gen1", sourceHandle: null, targetHandle: null }),
    ).toBe(true);
    const edge = store.scene.edges[0];
    if (!edge) throw new Error("no edge");
    store.onReconnect(edge, { source: "p2", target: "gen1", sourceHandle: null, targetHandle: null });
    store.endReconnect("e1", true);
    expect(store.scene.edges).toMatchObject([{ id: "e1", source: "p2", target: "gen1" }]);
    const arrow = store.liveElements().find((e) => e.id === "e1");
    expect(arrow).toMatchObject({ startBinding: { elementId: "p2" }, endBinding: { elementId: "gen1" } });
    expect(arrow?.version).toBeGreaterThan(1);
    store.undo();
    expect(store.scene.edges).toMatchObject([{ id: "e1", source: "p1" }]);
  });

  it("an edge end dragged onto empty canvas disconnects; onto a node it stays", () => {
    const store = makeStore([prompt, generator, link("e1", "p1", "gen1")]);
    store.beginReconnect("e1");
    store.endReconnect("e1", true);
    expect(store.scene.edges).toHaveLength(1);
    store.beginReconnect("e1");
    store.endReconnect("e1", false);
    expect(store.scene.edges).toEqual([]);
    // The reconnect flag is cleared: a repeat is refused again.
    expect(
      store.isValidConnection({ source: "p1", target: "gen1", sourceHandle: null, targetHandle: null }),
    ).toBe(true);
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

describe("chained generators (链式)", () => {
  const upstream = el("gen0", "generator", {
    x: -400,
    width: 296,
    height: 360,
    customData: {
      generator: {
        model: "m",
        count: 2,
        prompt: "上游",
        run: {
          batchId: "b0",
          startedAt: 1,
          jobs: [
            { jobId: "job-a", slot: { x: 0, y: 0, width: 10, height: 10 } },
            { jobId: "job-b", slot: { x: 0, y: 20, width: 10, height: 10 } },
          ],
        },
      },
    },
  });
  const placedA = el("imgA", "image", { y: 20, fileId: "fa", customData: { jobId: "job-a" } });
  const placedB = el("imgB", "image", { y: 0, fileId: "fb", customData: { jobId: "job-b" } });

  it("hands on the latest run's pictures in slot order, and waits for the rest", () => {
    const waiting = makeStore([upstream, placedA, generator, link("e1", "gen0", "gen1")]);
    const partial = generatorInputs(waiting.scene.nodes, waiting.scene.edges, "gen1");
    expect(partial.images.map((e) => e.id)).toEqual(["imgA"]);
    expect(partial.upstream).toEqual([{ id: "gen0", pictures: 1, waiting: true }]);
    expect(partial.links).toEqual([{ edgeId: "e1", sourceId: "gen0", kind: "generator" }]);

    const done = makeStore([upstream, placedB, placedA, generator, link("e1", "gen0", "gen1")]);
    const inputs = generatorInputs(done.scene.nodes, done.scene.edges, "gen1");
    expect(inputs.images.map((e) => e.id)).toEqual(["imgA", "imgB"]);
  });

  it("an upstream with no pictures blocks the plan with a reason", () => {
    const fresh = el("gen0", "generator", { x: -400, width: 296, height: 360 });
    const store = makeStore([fresh, generator, link("e1", "gen0", "gen1")]);
    const inputs = generatorInputs(store.scene.nodes, store.scene.edges, "gen1");
    const plan = planGenerator({
      config: readGenerator(store.element("gen1") as SceneElement),
      inputs: { ...inputs, imageCount: inputs.images.length },
      models: [{ id: "gpt-image-2", displayName: "GPT Image 2", description: "", keyId: 3 } as ImageModelInfo],
      prefs: null,
      accountSettled: true,
      modelsLoading: false,
      modelsError: null,
    });
    expect(plan.blockedReason).toBe("上游「生成」还没有图，先生成上游");
    expect(plan.params).toBeNull();
  });
});

describe("generator plan (第 56 条)", () => {
  const models = [
    { id: "gpt-image-2", displayName: "GPT Image 2", description: "", keyId: 3, keyName: "A" },
    { id: "nano-banana-pro", displayName: "Nano Banana Pro", description: "", keyId: 3, keyName: "A" },
    { id: "gpt-image-2", displayName: "GPT Image 2", description: "", keyId: 9, keyName: "B" },
  ] as ImageModelInfo[];
  const base = {
    inputs: { prompts: ["猫"], upstream: [], imageCount: 0 },
    prefs: { image_key_id: 3, default_image_model: "nano-banana-pro" },
    accountSettled: true,
    modelsLoading: false,
    modelsError: null,
    models,
  };
  const config = (extra: object) =>
    readGenerator(el("g", "generator", { customData: { generator: extra } }));

  it("sends the node's model through the node's key", () => {
    const plan = planGenerator({ ...base, config: config({ model: "gpt-image-2", keyId: 9 }) });
    expect(plan.params).toMatchObject({ model: "gpt-image-2", keyId: 9 });
  });

  it("sends GPT Image 2.5's output options and drops them for other models (第 66 条)", () => {
    const withSunburst = [
      ...models,
      {
        id: "gpt-image-2.5-sunburst",
        displayName: "GPT Image 2.5 Sunburst",
        description: "",
        keyId: 3,
        keyName: "A",
        qualities: ["auto", "low", "medium", "high", "xhigh", "max"],
        backgrounds: ["auto", "opaque", "transparent"],
        outputFormats: ["jpeg", "png", "webp"],
        moderations: ["auto", "low"],
      },
    ] as ImageModelInfo[];
    const options = { quality: "max", background: "transparent", moderation: "low", outputCompression: 70 };
    const sunburst = planGenerator({
      ...base,
      models: withSunburst,
      config: config({ model: "gpt-image-2.5-sunburst", keyId: 3, ...options }),
    });
    expect(sunburst.params).toMatchObject({
      quality: "max",
      background: "transparent",
      // Transparent needs png; compression means nothing for png.
      outputFormat: "png",
      outputCompression: null,
      moderation: "low",
    });
    // The node keeps its settings; Nano Banana Pro just does not get them.
    const pro = planGenerator({
      ...base,
      models: withSunburst,
      config: config({ model: "nano-banana-pro", keyId: 3, ...options }),
    });
    expect(pro.params).toMatchObject({
      quality: "auto",
      background: "auto",
      outputFormat: null,
      moderation: "auto",
    });
  });

  it("a key that went away falls back to the same model on another key", () => {
    const plan = planGenerator({ ...base, config: config({ model: "gpt-image-2", keyId: 44 }) });
    expect(plan.params).toMatchObject({ model: "gpt-image-2", keyId: 3 });
    expect(plan.pickedHere).toBe(true);
  });

  it("no model of its own: the account default, once the account is in", () => {
    expect(planGenerator({ ...base, config: config({}) }).params).toMatchObject({
      model: "nano-banana-pro",
      keyId: 3,
    });
    const early = planGenerator({ ...base, accountSettled: false, config: config({}) });
    expect(early.blockedReason).toBe("正在读取默认模型");
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

  it("sends the node's key with its model, and runs several generators at once", async () => {
    // Close below the first: on their own, both would take the same space.
    const second = el("gen2", "generator", {
      x: 300,
      y: 150,
      width: 296,
      height: 360,
      customData: { generator: { model: "nano-banana-pro", count: 1, prompt: "" } },
    });
    const store = makeStore([prompt, generator, second, link("e1", "p1", "gen1"), link("e2", "p1", "gen2")]);
    const runtime = new GeneratorRuntime(store, deps);
    const sent = await runtime.generateMany([
      {
        generatorId: "gen1",
        params: { model: "gpt-image-2", keyId: 9, aspectRatio: "1:1", resolution: "2K", quality: "auto" },
      },
      {
        generatorId: "gen2",
        params: { model: "nano-banana-pro", keyId: 3, aspectRatio: "1:1", resolution: "2K", quality: "auto" },
      },
    ]);
    expect(sent).toBe(2);
    expect(api.createImageBatch).toHaveBeenCalledTimes(2);
    const bodies = api.createImageBatch.mock.calls.map((call) => call[1]);
    expect(bodies[0]).toMatchObject({ model: "gpt-image-2", key_id: 9, canvas_source_id: "gen1" });
    expect(bodies[1]).toMatchObject({ model: "nano-banana-pro", key_id: 3, canvas_source_id: "gen2", prompt: "雨夜的霓虹街道" });
    // Sent together, their pictures still get separate places.
    type Slot = { x: number; y: number; width: number; height: number };
    const overlaps = (a: Slot, b: Slot) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const slotsA = bodies[0].canvas_slots as Slot[];
    const slotsB = bodies[1].canvas_slots as Slot[];
    expect(slotsA.some((a) => slotsB.some((b) => overlaps(a, b)))).toBe(false);
  });

  it("uploads a picture that only exists in this page before sending", async () => {
    const store = makeStore(
      [generator, reference, link("e2", "ref1", "gen1")],
      {
        f1: { id: "f1", dataURL: "data:image/png;base64,iVBORw0KGgo=" },
      },
    );
    // The page's CSP (connect-src 'self') refuses fetch() of a data: URL:
    // the picture is decoded in the page, never requested.
    const fetchSpy = vi.fn(
      async () => new Response(new Blob(["png"], { type: "image/png" })),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const runtime = new GeneratorRuntime(store, deps);
    await runtime.generate("gen1", {
      model: "m",
      aspectRatio: "1:1",
      resolution: "1K",
      quality: "low",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(api.uploadFile).toHaveBeenCalledTimes(1);
    const uploaded = api.uploadFile.mock.calls[0]?.[1] as File;
    expect(uploaded).toMatchObject({ name: "ref1.png", type: "image/png" });
    expect(uploaded.size).toBe(8); // the 8 bytes of the PNG signature
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
