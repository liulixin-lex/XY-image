import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeImageJob = vi.fn();
const insertImageElement = vi.fn();
const close = vi.fn(async () => {});
vi.mock("../../xy2api/image-runner.js", () => ({ executeImageJob }));
vi.mock("../../xy2api/services.js", () => ({
  createXy2apiServices: () => ({ providers: { network: { close } } }),
}));
vi.mock("../../canvas/canvas-element-writer.js", () => ({
  insertImageElement,
}));

const { getExecutor } = await import("../job-executor.js");
await import("./image-generation.js");

// The worker places an agent image on its canvas, so a result the agent
// stopped waiting for (storage retries, poll limit) still reaches the page.
const RESULT = {
  object_path: "ws-1/generated/job-1.png",
  width: 1024,
  height: 768,
  mime_type: "image/png",
  signed_url:
    "https://db.test/storage/v1/object/public/project-assets/ws-1/generated/job-1.png",
};
const admin = { from: vi.fn(), storage: { from: vi.fn() } };

function run(job: { canvas_id: string | null; payload?: unknown }) {
  const getJobAdmin = vi.fn(async () => job);
  const ctx = {
    env: {},
    getAdminClient: () => admin,
    jobService: { getJobAdmin },
  } as never;
  const executor = getExecutor("image_generation");
  if (!executor) throw new Error("image_generation executor not registered");
  return executor("job-1", {}, ctx);
}

beforeEach(() => {
  executeImageJob.mockResolvedValue(RESULT);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("image_generation executor", () => {
  it("places an agent image on its canvas and returns the element", async () => {
    insertImageElement.mockResolvedValue({ elementId: "el-1", inserted: true });
    const result = await run({
      canvas_id: "canvas-1",
      payload: { prompt: "a red fox", title: "Fox" },
    });
    expect(result).toEqual({ ...RESULT, element_id: "el-1" });
    expect(insertImageElement).toHaveBeenCalledWith(admin, {
      canvasId: "canvas-1",
      objectPath: RESULT.object_path,
      width: 1024,
      height: 768,
      mimeType: "image/png",
      jobId: "job-1",
      title: "Fox",
    }, undefined);
    expect(close).toHaveBeenCalled();
  });

  it("puts a generator node's picture in its slot, linked to the node", async () => {
    insertImageElement.mockResolvedValue({ elementId: "el-1", inserted: true });
    const slot = { x: 300, y: 100, width: 256, height: 256 };
    await run({
      canvas_id: "canvas-1",
      payload: { prompt: "a red fox", canvas_slot: slot, canvas_source_id: "gen-1" },
    });
    expect(insertImageElement).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ canvasId: "canvas-1", sourceElementId: "gen-1" }),
      slot,
    );
  });

  it("ignores a malformed placement and still places the picture", async () => {
    insertImageElement.mockResolvedValue({ elementId: "el-1", inserted: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run({
      canvas_id: "canvas-1",
      payload: { prompt: "a red fox", canvas_slot: { x: 0 }, canvas_source_id: "../x" },
    });
    const [, opts, slot] = insertImageElement.mock.calls[0] ?? [];
    expect(opts).not.toHaveProperty("sourceElementId");
    expect(slot).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("canvas placement ignored"));
  });

  it("titles it with the start of the prompt for jobs without a title", async () => {
    insertImageElement.mockResolvedValue({
      elementId: "el-1",
      inserted: false,
    });
    await run({ canvas_id: "canvas-1", payload: { prompt: "x".repeat(60) } });
    expect(insertImageElement.mock.calls[0]?.[1].title).toBe("x".repeat(40));
  });

  it("leaves jobs without a canvas alone", async () => {
    expect(await run({ canvas_id: null })).toEqual(RESULT);
    expect(insertImageElement).not.toHaveBeenCalled();
  });

  it("still succeeds when placing fails (the image is in the history)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    insertImageElement.mockRejectedValue(
      new Error("Canvas not found: canvas-1"),
    );
    expect(await run({ canvas_id: "canvas-1" })).toEqual(RESULT);
  });
});
