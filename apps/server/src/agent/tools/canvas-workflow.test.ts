import { describe, expect, it, vi } from "vitest";

import type {
  CanvasContent,
  CanvasElement,
} from "../../features/canvas/canvas-mutation.js";
import {
  WORKFLOW_COUNT_MAX,
  applyWorkflow,
  createCanvasWorkflowTool,
  createRunWorkflowTool,
  generatorInputs,
  readGenerator,
} from "./canvas-workflow.js";

const models = [
  { id: "gpt-image-2", displayName: "GPT Image 2", provider: "xy2api" },
  {
    id: "gemini-3-pro-image",
    displayName: "Nano Banana Pro",
    provider: "xy2api",
  },
] as never[];

const live = (content: CanvasContent) =>
  (content.elements ?? []).filter((el) => !el.isDeleted);
const byType = (content: CanvasContent, type: string) =>
  live(content).filter((el) => el.type === type);
const edges = (content: CanvasContent) =>
  byType(content, "arrow").map((el) => [
    (el.startBinding as { elementId: string }).elementId,
    (el.endBinding as { elementId: string }).elementId,
  ]);

describe("canvas_workflow (第 69 条)", () => {
  it("builds cards, generators, connections and a frame in one call, laid out left to right", () => {
    const content: CanvasContent = {
      elements: [
        { id: "old", type: "image", x: 0, y: 0, width: 400, height: 300 },
      ],
    };
    const { changed, result } = applyWorkflow(
      content,
      [
        {
          action: "add_prompt",
          ref: "p1",
          text: "春节海报，红金配色，留出标题位置",
        },
        {
          action: "add_generator",
          ref: "g1",
          prompt: "竖版海报",
          aspect_ratio: "3:4",
          resolution: "4K",
          quality: "high",
          count: 2,
          model: "GPT Image 2",
        },
        {
          action: "add_generator",
          ref: "g2",
          prompt: "把上一张改成横版 banner",
          aspect_ratio: "16:9",
        },
        { action: "connect", from: "p1", to: "g1" },
        { action: "connect", from: "g1", to: "g2" },
        { action: "connect", from: "old", to: "g1" },
        {
          action: "add_frame",
          title: "春节物料",
          contains: ["p1", "g1", "g2"],
        },
      ],
      models,
    );
    expect(changed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary).toBe(
      "加了 1 个提示词卡片、2 个生成节点、3 条连线、1 个分组框",
    );
    const prompt = byType(content, "prompt")[0] as CanvasElement;
    const [g1, g2] = byType(content, "generator") as CanvasElement[];
    expect(prompt.text).toBe("春节海报，红金配色，留出标题位置");
    expect(readGenerator(g1 as CanvasElement)).toMatchObject({
      model: "gpt-image-2",
      aspectRatio: "3:4",
      resolution: "4K",
      quality: "high",
      count: 2,
      prompt: "竖版海报",
    });
    // Right of the existing picture; card → generator → (pictures) → next generator.
    expect(Number(prompt.x)).toBeGreaterThanOrEqual(400);
    expect(Number(g1?.x)).toBeGreaterThan(
      Number(prompt.x) + Number(prompt.width),
    );
    expect(Number(g2?.x)).toBeGreaterThan(Number(g1?.x) + 600);
    expect(g2?.y).toBe(g1?.y);
    expect(edges(content)).toEqual([
      [prompt.id, g1?.id],
      [g1?.id, g2?.id],
      ["old", g1?.id],
    ]);
    // Arrows run from the source's right middle to the target's left middle.
    const arrow = byType(content, "arrow")[0] as CanvasElement;
    expect(arrow.x).toBe(Number(prompt.x) + Number(prompt.width));
    expect((arrow.points as number[][])[1]?.[0]).toBe(
      Number(g1?.x) - Number(arrow.x),
    );
    const frame = byType(content, "frame")[0] as CanvasElement;
    expect(frame.name).toBe("春节物料");
    expect(Number(frame.x)).toBeLessThan(Number(prompt.x));
    expect(Number(frame.x) + Number(frame.width)).toBeGreaterThan(
      Number(g2?.x) + Number(g2?.width),
    );
    expect(result.created).toMatchObject({
      p1: prompt.id,
      g1: g1?.id,
      g2: g2?.id,
    });
  });

  it("refuses connections that cannot work and says why", () => {
    const content: CanvasContent = { elements: [] };
    const { result } = applyWorkflow(content, [
      { action: "add_prompt", ref: "a", text: "x" },
      { action: "add_prompt", ref: "b", text: "y" },
      { action: "connect", from: "a", to: "b" },
      { action: "connect", from: "a", to: "nope" },
      { action: "add_prompt", text: "" },
    ]);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toMatch(/goes into a generator/);
    expect(byType(content, "arrow")).toHaveLength(0);
  });

  it("caps pictures per generator and keeps unknown settings at their defaults", () => {
    const content: CanvasContent = { elements: [] };
    const { result } = applyWorkflow(content, [
      { action: "add_generator", ref: "g", count: 50, aspect_ratio: "7:3" },
    ]);
    const g = byType(content, "generator")[0] as CanvasElement;
    expect(readGenerator(g).count).toBe(WORKFLOW_COUNT_MAX);
    expect(readGenerator(g).aspectRatio).toBe("1:1");
    expect(result.errors[0]).toMatch(/aspect_ratio 7:3/);
  });

  it("updates, moves and deletes existing nodes, edges following them", () => {
    const content: CanvasContent = { elements: [] };
    applyWorkflow(content, [
      { action: "add_prompt", ref: "p", text: "旧描述" },
      { action: "add_generator", ref: "g" },
      { action: "connect", from: "p", to: "g" },
    ]);
    const prompt = byType(content, "prompt")[0] as CanvasElement;
    const generator = byType(content, "generator")[0] as CanvasElement;
    const version = Number(generator.version);
    applyWorkflow(content, [
      { action: "update_prompt", id: String(prompt.id), text: "新描述" },
      {
        action: "update_generator",
        id: String(generator.id),
        prompt: "加一只猫",
        count: 3,
      },
      { action: "move", id: String(generator.id), x: 2000, y: 500 },
    ]);
    expect(prompt.text).toBe("新描述");
    expect(readGenerator(generator)).toMatchObject({
      prompt: "加一只猫",
      count: 3,
    });
    expect(Number(generator.version)).toBeGreaterThan(version);
    const arrow = byType(content, "arrow")[0] as CanvasElement;
    expect((arrow.points as number[][])[1]?.[0]).toBe(2000 - Number(arrow.x));
    applyWorkflow(content, [{ action: "delete", id: String(prompt.id) }]);
    expect(byType(content, "prompt")).toHaveLength(0);
    expect(byType(content, "arrow")).toHaveLength(0);
    expect(byType(content, "generator")).toHaveLength(1);
  });

  it("writes through mutateCanvas and reports a missing canvas", async () => {
    const client = fakeCanvas({ elements: [] });
    const tool = createCanvasWorkflowTool({
      createUserClient: () => client,
      availableModels: models,
    });
    const config = { configurable: { canvas_id: "c1", access_token: "t" } };
    const out = JSON.parse(
      String(
        await tool.invoke(
          { operations: [{ action: "add_prompt", text: "hello" }] },
          config,
        ),
      ),
    );
    expect(out.summary).toBe("加了 1 个提示词卡片");
    expect(byType(client.content, "prompt")).toHaveLength(1);
    const none = createCanvasWorkflowTool({
      createUserClient: () => fakeCanvas(null),
    });
    expect(
      JSON.parse(
        String(
          await none.invoke(
            { operations: [{ action: "add_prompt", text: "x" }] },
            config,
          ),
        ),
      ).error,
    ).toBe("canvas_not_found");
  });
});

describe("run_workflow (第 69 条)", () => {
  function chain() {
    const content: CanvasContent = {
      elements: [
        {
          id: "ref",
          type: "image",
          x: 0,
          y: 600,
          width: 300,
          height: 300,
          fileId: "f1",
        },
      ],
      files: { f1: { id: "f1", dataURL: "oss://canvas-files/u/ref.png" } },
    };
    applyWorkflow(content, [
      { action: "add_prompt", ref: "p", text: "一只橘猫坐在窗台上" },
      { action: "add_generator", ref: "g1", prompt: "胶片质感", count: 2 },
      {
        action: "add_generator",
        ref: "g2",
        prompt: "改成水彩风格",
        aspect_ratio: "16:9",
      },
      { action: "connect", from: "p", to: "g1" },
      { action: "connect", from: "ref", to: "g1" },
      { action: "connect", from: "g1", to: "g2" },
    ]);
    const [g1, g2] = byType(content, "generator") as CanvasElement[];
    return { content, g1: String(g1?.id), g2: String(g2?.id) };
  }

  it("reads what feeds a generator: cards first, pictures, an upstream's latest run", () => {
    const { content, g1, g2 } = chain();
    expect(generatorInputs(content, g1)).toMatchObject({
      prompts: ["一只橘猫坐在窗台上"],
      upstream: [],
    });
    expect(generatorInputs(content, g1).images.map((el) => el.id)).toEqual([
      "ref",
    ]);
    expect(generatorInputs(content, g2).upstream).toEqual([
      { id: g1, pictures: 0, waiting: false },
    ]);
  });

  it("runs a chain upstream first, waits for its pictures, then runs the next with them", async () => {
    const { content, g1, g2 } = chain();
    const client = fakeCanvas(content);
    const sent: Array<Record<string, unknown>> = [];
    let n = 0;
    const submitBatch = vi.fn(async (input: Record<string, unknown>) => {
      sent.push(input);
      const count = Number(input.count);
      return {
        batchId: `b${sent.length}`,
        requested: count,
        jobs: Array.from({ length: count }, (_, i) => ({
          id: `job${++n}`,
          batchIndex: i,
        })),
      };
    });
    // The worker places each picture in its slot with the job id.
    const waitForJobs = vi.fn(async (ids: string[]) => {
      for (const id of ids) {
        const owner = (client.content.elements ?? []).find((el) =>
          readGenerator(el).run?.jobs.some((job) => job.jobId === id),
        ) as CanvasElement;
        const slot = readGenerator(owner).run?.jobs.find(
          (job) => job.jobId === id,
        )?.slot;
        client.content.elements?.push({
          id: `img-${id}`,
          type: "image",
          ...slot,
          customData: { jobId: id },
          fileId: `f-${id}`,
        });
        (client.content.files as Record<string, unknown>)[`f-${id}`] = {
          id: `f-${id}`,
          dataURL: `oss://canvas-files/u/${id}.png`,
        };
      }
      return ids.map((id) => ({
        id,
        status: "succeeded",
        elementId: `img-${id}`,
      }));
    });
    const notifyCanvas = vi.fn();
    const tool = createRunWorkflowTool({
      createUserClient: () => client,
      submitBatch: submitBatch as never,
      waitForJobs,
      notifyCanvas,
      pictureUrl: (_client, el, files) => {
        const file = files?.[String(el.fileId)];
        return typeof file?.dataURL === "string"
          ? file.dataURL.replace("oss://", "https://img.test/")
          : null;
      },
    });
    const out = JSON.parse(
      String(
        await tool.invoke(
          { generator_ids: [g2, g1] },
          { configurable: { canvas_id: "c1", access_token: "t" } },
        ),
      ),
    );
    expect(out.summary).toBe("出了 3 张图");
    expect(sent.map((s) => s.canvasSourceId)).toEqual([g1, g2]);
    expect(sent[0]).toMatchObject({
      prompt: "一只橘猫坐在窗台上\n\n胶片质感",
      count: 2,
      inputImages: ["https://img.test/canvas-files/u/ref.png"],
    });
    // The second gets the first's two pictures as references.
    expect(sent[1]).toMatchObject({
      prompt: "改成水彩风格",
      aspectRatio: "16:9",
      inputImages: [
        "https://img.test/canvas-files/u/job1.png",
        "https://img.test/canvas-files/u/job2.png",
      ],
    });
    // Slots are right of the generator; the run is written into it.
    const generator = (client.content.elements ?? []).find(
      (el) => el.id === g1,
    ) as CanvasElement;
    const run = readGenerator(generator).run;
    expect(run?.jobs.map((job) => job.jobId)).toEqual(["job1", "job2"]);
    expect(run?.jobs[0]?.slot.x).toBeGreaterThan(
      Number(generator.x) + Number(generator.width),
    );
    expect(out.runs[0]).toMatchObject({
      id: g1,
      sent: 2,
      pictures: ["img-job1", "img-job2"],
    });
    expect(notifyCanvas).toHaveBeenCalled();
  });

  it("says why a generator was not run, without sending anything", async () => {
    const content: CanvasContent = { elements: [] };
    applyWorkflow(content, [
      { action: "add_generator", ref: "empty" },
      { action: "add_generator", ref: "down", prompt: "x" },
      { action: "add_generator", ref: "up", prompt: "y" },
      { action: "connect", from: "up", to: "down" },
    ]);
    const [empty, down] = byType(content, "generator") as CanvasElement[];
    const submitBatch = vi.fn();
    const tool = createRunWorkflowTool({
      createUserClient: () => fakeCanvas(content),
      submitBatch: submitBatch as never,
      waitForJobs: vi.fn(),
      pictureUrl: () => null,
    });
    const out = JSON.parse(
      String(
        await tool.invoke(
          { generator_ids: [String(empty?.id), String(down?.id), "missing"] },
          { configurable: { canvas_id: "c1", access_token: "t" } },
        ),
      ),
    );
    expect(submitBatch).not.toHaveBeenCalled();
    expect(out.summary).toBe("没有发出任何生成");
    expect(out.runs.map((r: { error: string }) => r.error)).toEqual([
      expect.stringContaining("没有描述"),
      expect.stringContaining("上游生成节点还没有图"),
      "画布上没有这个生成节点",
    ]);
  });
});

/** A canvases table of one row, with updated_at checks like PostgREST. */
function fakeCanvas(initial: CanvasContent | null) {
  const state = {
    content: (initial ?? { elements: [] }) as CanvasContent,
    updatedAt: 1,
    exists: initial !== null,
  };
  const client = {
    get content() {
      return state.content;
    },
    from() {
      let patch: CanvasContent | null = null;
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        update: (row: { content: CanvasContent }) => {
          patch = row.content;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        single: async () =>
          state.exists
            ? {
                data: { content: state.content, updated_at: state.updatedAt },
                error: null,
              }
            : { data: null, error: { code: "PGRST116", message: "none" } },
        then: (resolve: (value: unknown) => void) => {
          if (patch && filters.updated_at === state.updatedAt) {
            state.content = patch;
            state.updatedAt++;
            resolve({ data: [{ id: "c1" }], error: null });
          } else resolve({ data: [], error: null });
        },
      };
      return chain;
    },
  };
  return client;
}
