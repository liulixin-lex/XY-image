import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GatewayError,
  gatewayDiagnostics,
  mapGatewayError,
} from "../features/xy2api/errors.js";
import { pictureRef } from "./tools/view-images.js";
import {
  MODEL_IMAGE_EDGE,
  createReviewImageStore,
  createVisionReviewMiddleware,
  refusesImages,
  reviewImagesOf,
  toModelImage,
  withReviewImages,
} from "./vision.js";

afterEach(() => vi.restoreAllMocks());

async function png(width: number, height: number) {
  return sharp({ create: { width, height, channels: 4, background: { r: 229, g: 83, b: 61, alpha: 0.5 } } })
    .png()
    .toBuffer();
}
const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;
const shotResult = (id: string, ref: string) =>
  new ToolMessage({
    tool_call_id: id,
    name: "screenshot_canvas",
    content: JSON.stringify({ summary: "captured", reviewImages: [{ ref, label: "画布截图" }] }),
  });
const call = (ids: string[]) =>
  new AIMessage({ content: "", tool_calls: ids.map((id) => ({ id, name: "screenshot_canvas", args: {} })) });

describe("pictures for the model (第 67 条 审图)", () => {
  it("shrinks a 4K picture to a small JPEG", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const big = await png(4096, 2304);
    const out = await toModelImage(big);
    expect(Math.max(out.width, out.height)).toBe(MODEL_IMAGE_EDGE);
    expect(out.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(out.size).toBeLessThan(big.length);
  });

  it("keeps screenshots for the run and reads canvas pictures with the user's storage", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const readObject = vi.fn(async () => png(800, 600));
    const store = createReviewImageStore({ readObject });
    const shot = store.addShot(dataUrl(await png(1200, 900)));
    expect(shot).toMatch(/^shot:/);
    expect(store.producedThisRun(shot ?? "")).toBe(true);
    expect(await store.load(shot ?? "")).toMatch(/^data:image\/jpeg/);
    expect(store.producedThisRun("oss://project-assets/w/a.png")).toBe(false);
    store.note("oss://project-assets/w/a.png");
    await store.load("oss://project-assets/w/a.png");
    await store.load("oss://project-assets/w/a.png");
    expect(readObject).toHaveBeenCalledOnce();
    expect(readObject).toHaveBeenCalledWith("project-assets", "w/a.png");
    expect(store.addShot("not a picture")).toBeNull();
  });

  it("finds an image element's stored picture", () => {
    const files = { f1: { dataURL: "oss://project-assets/w/generated/j.png" }, f2: { dataURL: "data:image/png;base64,AA" } };
    expect(pictureRef({ id: "a", type: "image", fileId: "f1" }, files)).toBe("oss://project-assets/w/generated/j.png");
    expect(pictureRef({ id: "b", type: "image", fileId: "f2" }, files)).toBeNull();
    expect(pictureRef({ id: "c", type: "image" }, files)).toBeNull();
  });

  it("puts the pictures after the block of tool results, keeping tool results together", () => {
    const messages = [
      new HumanMessage("排一下版"),
      call(["t1", "t2"]),
      shotResult("t1", "shot:1"),
      new ToolMessage({ tool_call_id: "t2", name: "inspect_canvas", content: "{}" }),
      new AIMessage("看完了"),
    ];
    const out = withReviewImages(messages, new Map([["shot:1", "data:image/jpeg;base64,AAAA"]]), new Set(["shot:1"]));
    expect(out.map((m) => m.getType())).toEqual(["human", "ai", "tool", "tool", "human", "ai"]);
    const shown = out[4] as HumanMessage;
    expect(JSON.stringify(shown.content)).toContain("data:image/jpeg;base64,AAAA");
    expect(JSON.stringify(shown.content)).toContain("画布截图");
    // Nothing kept: nothing inserted.
    expect(withReviewImages(messages, new Map(), new Set())).toHaveLength(messages.length);
  });

  it("reads the references only from review tools", () => {
    expect(reviewImagesOf(shotResult("t", "shot:9"))).toEqual([{ ref: "shot:9", label: "画布截图" }]);
    expect(
      reviewImagesOf(new ToolMessage({ tool_call_id: "x", name: "inspect_canvas", content: JSON.stringify({ reviewImages: [{ ref: "shot:1" }] }) })),
    ).toEqual([]);
    expect(reviewImagesOf(new ToolMessage({ tool_call_id: "x", name: "view_images", content: "not json" }))).toEqual([]);
  });
});

describe("the review middleware", () => {
  async function setup(count: number) {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createReviewImageStore({});
    const messages: Array<AIMessage | HumanMessage | ToolMessage> = [new HumanMessage("检查一下")];
    const refs: string[] = [];
    for (let i = 0; i < count; i++) {
      const ref = store.addShot(dataUrl(await png(100 + i, 100))) ?? "";
      refs.push(ref);
      messages.push(call([`t${i}`]), shotResult(`t${i}`, ref));
    }
    const mw = createVisionReviewMiddleware(store) as unknown as {
      wrapModelCall: (request: unknown, handler: (r: { messages: unknown[] }) => Promise<unknown>) => Promise<unknown>;
    };
    return { store, messages, refs, mw };
  }
  const images = (messages: unknown[]) =>
    messages.filter((m) => HumanMessage.isInstance(m as never) && JSON.stringify((m as HumanMessage).content).includes("data:image/jpeg")).length;

  it("shows only the latest three pictures of the run", async () => {
    const { messages, mw } = await setup(5);
    const seen: unknown[][] = [];
    await mw.wrapModelCall({ messages, tools: [] }, async (r) => {
      seen.push(r.messages);
      return new AIMessage("ok");
    });
    expect(images(seen[0] ?? [])).toBe(3);
    expect(messages).toHaveLength(11); // the conversation itself is unchanged
  });

  it("calls again without pictures when the model refuses them, and stays off", async () => {
    const { messages, mw } = await setup(1);
    const seen: unknown[][] = [];
    const refusal = new GatewayError({
      ...mapGatewayError({ status: 400, body: { error: { message: "image_url is not supported by this model" } }, responseReceived: true }),
      diagnostics: gatewayDiagnostics({ status: 400, body: { error: { message: "image_url is not supported by this model" } } }),
    });
    expect(refusesImages(refusal)).toBe(true);
    let first = true;
    const handler = async (r: { messages: unknown[] }) => {
      seen.push(r.messages);
      if (first) {
        first = false;
        throw Object.assign(new Error("Connection error."), { cause: refusal });
      }
      return new AIMessage("ok");
    };
    await mw.wrapModelCall({ messages, tools: [] }, handler);
    await mw.wrapModelCall({ messages, tools: [] }, handler);
    expect(seen.map(images)).toEqual([1, 0, 0]);
  });

  it("lets other errors through", async () => {
    const { messages, mw } = await setup(1);
    await expect(
      mw.wrapModelCall({ messages, tools: [] }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
