import { afterEach, describe, expect, it, vi } from "vitest";
import { insertImageElement } from "./canvas-element-writer.js";
import { createCanvasService } from "./canvas-service.js";

// An agent image that finishes after the agent stopped waiting (held for
// storage retries, or past its poll limit) is placed by the worker. Until
// 10-09 nothing placed it, and a save from the open page would have dropped
// it anyway: saves replaced the stored elements wholesale.
const user = {
  id: "user-1",
  accessToken: "token-1",
  email: "",
  userMetadata: {},
};
const MARKER = "oss://project-assets/ws-1/generated/job-1.png";
const rect = (id: string) => ({
  type: "rectangle",
  id,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
});
const placed = (id: string, jobId: string) => ({
  type: "image",
  id,
  fileId: `file-${id}`,
  customData: { jobId },
});

type Element = Record<string, unknown>;
type Content = {
  elements: Element[];
  appState: Element;
  files: Record<string, Element>;
};

/**
 * One canvases row with `updated_at` versioning: conditional writes
 * (`.eq("updated_at", read)`) land only on the version they read. `onWrite`
 * runs before each write, to change the row under the writer.
 */
function fakeCanvas(initial: Partial<Content> = {}) {
  const state = {
    content: { elements: [], appState: {}, files: {}, ...initial } as Content,
    version: 1,
  };
  const writes: Content[] = [];
  let refused = 0;
  const hooks: { onWrite?: (attempt: number) => void } = {};
  const stamp = () => `2026-10-09T00:00:0${state.version}Z`;
  const change = (content: Content) => {
    state.content = content;
    state.version++;
  };

  function from() {
    const filters: Record<string, unknown> = {};
    let update: { content: Content } | undefined;
    const run = async () => {
      if (!update) {
        return {
          data: {
            id: "canvas-1",
            updated_at: stamp(),
            content: structuredClone(state.content),
            files: structuredClone(state.content.files),
            elements: structuredClone(state.content.elements),
            projects: { workspace_id: "ws-1" },
          },
          error: null,
        };
      }
      hooks.onWrite?.(writes.length + refused + 1);
      if ("updated_at" in filters && filters.updated_at !== stamp()) {
        refused++;
        return { data: [], error: null };
      }
      writes.push(update.content);
      change(update.content);
      return { data: [{ id: "canvas-1" }], error: null };
    };
    const builder = {
      select: () => builder,
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      update(values: { content: Content }) {
        update = values;
        return builder;
      },
      single: run,
      maybeSingle: run,
      // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable query builder
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => run().then(resolve, reject),
    };
    return builder;
  }
  const storage = { from: () => ({}) };
  return {
    client: { from, storage } as never,
    state,
    writes,
    hooks,
    change,
    refused: () => refused,
  };
}

const insert = (fake: ReturnType<typeof fakeCanvas>, jobId?: string) =>
  insertImageElement(fake.client, {
    canvasId: "canvas-1",
    objectPath: "ws-1/generated/job-1.png",
    width: 512,
    height: 512,
    mimeType: "image/png",
    ...(jobId ? { jobId } : {}),
  });

function save(
  fake: ReturnType<typeof fakeCanvas>,
  elements: Element[],
  deletedElementIds?: string[],
) {
  const service = createCanvasService({ createUserClient: () => fake.client });
  return service.saveCanvasContent(
    user,
    "canvas-1",
    { elements, appState: {}, files: {} } as never,
    deletedElementIds ? { deletedElementIds } : undefined,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("placing a job's image on the canvas", () => {
  it("places it once per job, however often asked", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fake = fakeCanvas({ elements: [rect("r1")] });
    const first = await insert(fake, "job-1");
    const again = await insert(fake, "job-1");
    expect(first.inserted).toBe(true);
    expect(again).toEqual({ elementId: first.elementId, inserted: false });
    expect(fake.writes).toHaveLength(1);
    const image = fake.state.content.elements.find(
      (el) => el.id === first.elementId,
    );
    expect(image?.customData).toMatchObject({ jobId: "job-1" });
    expect(fake.state.content.files[image?.fileId as string]?.dataURL).toBe(
      MARKER,
    );
  });

  it("places it again when the earlier one was deleted", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fake = fakeCanvas({
      elements: [{ ...placed("old", "job-1"), isDeleted: true }],
    });
    expect((await insert(fake, "job-1")).inserted).toBe(true);
  });

  it("does not overwrite a save that lands between its read and write", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = fakeCanvas({ elements: [rect("r1")] });
    fake.hooks.onWrite = (attempt) => {
      if (attempt === 1) {
        fake.change({
          ...fake.state.content,
          elements: [rect("r1"), rect("r2")],
        });
      }
    };
    const { elementId } = await insert(fake, "job-1");
    expect(fake.refused()).toBe(1);
    expect(fake.state.content.elements.map((el) => el.id)).toEqual([
      "r1",
      "r2",
      elementId,
    ]);
  });

  it("gives up after four changed reads instead of overwriting", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = fakeCanvas();
    fake.hooks.onWrite = () => fake.change({ ...fake.state.content });
    await expect(insert(fake, "job-1")).rejects.toThrow(/image not inserted/);
    expect(fake.refused()).toBe(4);
    expect(fake.writes).toEqual([]);
  });
});

describe("placing a generator node's picture (node canvas)", () => {
  const generator = {
    type: "generator",
    id: "gen-1",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
  };
  const slot = { x: 380, y: -40, width: 240, height: 320 };
  const placeFromGenerator = (fake: ReturnType<typeof fakeCanvas>) =>
    insertImageElement(
      fake.client,
      {
        canvasId: "canvas-1",
        objectPath: "ws-1/generated/job-1.png",
        width: 1536,
        height: 2048,
        mimeType: "image/png",
        jobId: "job-1",
        sourceElementId: "gen-1",
      },
      slot,
    );

  it("puts it in its slot with an edge from the generator", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fake = fakeCanvas({ elements: [generator] });
    const { elementId } = await placeFromGenerator(fake);
    const [, image, edge] = fake.state.content.elements;
    expect(image).toMatchObject({ id: elementId, type: "image", ...slot });
    expect(edge).toMatchObject({
      type: "arrow",
      x: 300,
      y: 100,
      points: [
        [0, 0],
        [80, 20],
      ],
      startBinding: { elementId: "gen-1" },
      endBinding: { elementId },
      customData: { edge: "output", jobId: "job-1" },
    });
    // Asked again: the image is found (not its edge), nothing is added.
    expect(await placeFromGenerator(fake)).toEqual({
      elementId,
      inserted: false,
    });
    expect(fake.state.content.elements).toHaveLength(3);
  });

  it("places it without an edge when the generator was deleted", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fake = fakeCanvas({ elements: [rect("r1")] });
    await placeFromGenerator(fake);
    expect(fake.state.content.elements.map((el) => el.type)).toEqual([
      "rectangle",
      "image",
    ]);
  });

  it("keeps an unseen edge on save like its image", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fake = fakeCanvas({ elements: [generator] });
    await placeFromGenerator(fake);
    await save(fake, [generator], []);
    expect(fake.state.content.elements.map((el) => el.type)).toEqual([
      "generator",
      "image",
      "arrow",
    ]);
  });
});

describe("saving a page that has not seen a placed image", () => {
  const stored = () =>
    fakeCanvas({
      elements: [rect("r1"), placed("img-1", "job-1")],
      files: {
        "file-img-1": {
          id: "file-img-1",
          dataURL: MARKER,
          mimeType: "image/png",
        },
      },
    });

  it("keeps the placed image and its file", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fake = stored();
    await expect(save(fake, [rect("r1"), rect("r2")], [])).resolves.toEqual({
      missingFileIds: [],
    });
    expect(fake.state.content.elements.map((el) => el.id)).toEqual([
      "r1",
      "r2",
      "img-1",
    ]);
    expect(fake.state.content.files["file-img-1"]?.dataURL).toBe(MARKER);
  });

  it("drops it when the page deleted it", async () => {
    const fake = stored();
    await save(fake, [rect("r1")], ["img-1"]);
    expect(fake.state.content.elements.map((el) => el.id)).toEqual(["r1"]);
  });

  it("keeps the old replace for pages that send no deleted ids", async () => {
    const fake = stored();
    await save(fake, [rect("r1")]);
    expect(fake.state.content.elements.map((el) => el.id)).toEqual(["r1"]);
  });

  it("does not keep elements the page removed that no job placed", async () => {
    const fake = stored();
    await save(fake, [placed("img-1", "job-1")], []);
    expect(fake.state.content.elements.map((el) => el.id)).toEqual(["img-1"]);
  });

  it("reads again when the worker places an image during the save", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fake = fakeCanvas({ elements: [rect("r1")] });
    fake.hooks.onWrite = (attempt) => {
      if (attempt === 1) {
        fake.change({
          ...fake.state.content,
          elements: [...fake.state.content.elements, placed("img-2", "job-2")],
        });
      }
    };
    await save(fake, [rect("r1"), rect("r2")], []);
    expect(fake.refused()).toBe(1);
    expect(fake.state.content.elements.map((el) => el.id)).toEqual([
      "r1",
      "r2",
      "img-2",
    ]);
  });

  it("writes on the last attempt even if the canvas keeps changing", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fake = fakeCanvas({ elements: [rect("r1")] });
    fake.hooks.onWrite = () => fake.change({ ...fake.state.content });
    await save(fake, [rect("r2")], []);
    expect(fake.refused()).toBe(2);
    expect(fake.state.content.elements.map((el) => el.id)).toEqual(["r2"]);
  });
});
