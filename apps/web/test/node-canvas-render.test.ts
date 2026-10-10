import { describe, expect, it, vi } from "vitest";

import {
  imageSourceOf,
  renderScene,
  wrapText,
} from "../src/lib/node-canvas/render";
import type { SceneElement } from "../src/lib/node-canvas/types";

/** A 2D context that records calls; jsdom has no canvas drawing. */
function fakeCanvas(
  width: number,
  height: number,
  calls: { name: string; args: unknown[] }[],
) {
  const ctx = new Proxy(
    {
      measureText: (text: string) => ({ width: text.length * 10 }),
    } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        return (...args: unknown[]) => calls.push({ name: prop, args });
      },
      set(target, prop: string, value) {
        target[prop] = value;
        return true;
      },
    },
  );
  const canvas = {
    width,
    height,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

/** Hands out fake canvases and keeps the calls drawn on them. */
function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  return {
    calls,
    createCanvas: (width: number, height: number) => {
      return fakeCanvas(width, height, calls).canvas;
    },
  };
}

const image = (id: string, x: number, fileId: string): SceneElement => ({
  id,
  type: "image",
  x,
  y: 0,
  width: 200,
  height: 100,
  fileId,
});

describe("node canvas renderer", () => {
  it("fits the scene in maxDimension and draws each picture in its box", async () => {
    const rec = recorder();
    const picture = { tag: "bitmap" } as unknown as CanvasImageSource;
    const loadImage = vi.fn(async (_src: string) => picture);
    const canvas = await renderScene(
      {
        elements: [
          image("a", 0, "f1"),
          image("b", 300, "f2"),
          { ...image("c", 0, "f3"), isDeleted: true },
        ],
        files: {
          f1: { id: "f1", storageUrl: "https://storage.example/f1.png" },
          f2: { id: "f2", dataURL: "data:image/png;base64,AA" },
        },
        theme: "dark",
        maxDimension: 280,
        padding: 20,
      },
      {
        createCanvas: rec.createCanvas,
        loadImage,
      },
    );
    // Scene 500×100 plus padding: 540×140 scaled to 280 wide.
    expect(canvas?.width).toBe(280);
    expect(canvas?.height).toBe(73);
    expect(loadImage.mock.calls.map(([src]) => src)).toEqual([
      "https://storage.example/f1.png",
      "data:image/png;base64,AA",
    ]);
    const draws = rec.calls.filter((c) => c.name === "drawImage");
    expect(draws.map((c) => c.args.slice(1))).toEqual([
      [0, 0, 200, 100],
      [300, 0, 200, 100],
    ]);
  });

  it("draws only what is inside the asked-for region", async () => {
    const rec = recorder();
    await renderScene(
      {
        elements: [image("a", 0, "f1"), image("b", 1000, "f2")],
        files: {
          f1: { id: "f1", dataURL: "data:a" },
          f2: { id: "f2", dataURL: "data:b" },
        },
        theme: "light",
        maxDimension: 1024,
        bounds: { x: 900, y: -50, width: 400, height: 200 },
      },
      {
        createCanvas: rec.createCanvas,
        loadImage: async () => ({}) as CanvasImageSource,
      },
    );
    const draws = rec.calls.filter((c) => c.name === "drawImage");
    expect(draws).toHaveLength(1);
    expect(draws[0]?.args.slice(1)).toEqual([1000, 0, 200, 100]);
  });

  it("draws a blank tile for a picture that did not load", async () => {
    const rec = recorder();
    const canvas = await renderScene(
      {
        elements: [image("a", 0, "missing")],
        files: {},
        theme: "light",
        maxDimension: 100,
      },
      {
        createCanvas: rec.createCanvas,
        loadImage: async () => null,
      },
    );
    expect(canvas).not.toBeNull();
    expect(rec.calls.some((c) => c.name === "drawImage")).toBe(false);
    expect(rec.calls.filter((c) => c.name === "fill").length).toBeGreaterThan(
      0,
    );
  });

  it("returns nothing for an empty canvas", async () => {
    expect(
      await renderScene({
        elements: [],
        files: {},
        theme: "light",
        maxDimension: 100,
      }),
    ).toBeNull();
  });

  it("prefers the stored file over inline data and the element's own URL", () => {
    const el = {
      ...image("a", 0, "f1"),
      customData: { storageUrl: "https://x/own.png" },
    };
    expect(
      imageSourceOf(el, {
        f1: { id: "f1", storageUrl: "https://x/f1.png", dataURL: "data:x" },
      }),
    ).toBe("https://x/f1.png");
    expect(imageSourceOf(el, {})).toBe("https://x/own.png");
  });

  it("wraps text without spaces by width", () => {
    const ctx = {
      measureText: (t: string) => ({ width: t.length * 10 }),
    } as never;
    expect(wrapText(ctx, "一二三四五\n六", 30)).toEqual([
      "一二三",
      "四五",
      "六",
    ]);
  });
});
