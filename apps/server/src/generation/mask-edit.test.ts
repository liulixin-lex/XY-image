import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { BillingGuardError } from "../features/xy2api/errors.js";
import {
  editPrompt,
  frameFor,
  highlightedCopy,
  openaiMaskPng,
  orientSource,
  outpaintImages,
  readPaintedMask,
} from "./mask-edit.js";

/** A studio-style mask: transparent, with an opaque block painted in. */
async function paintedPng(
  width: number,
  height: number,
  block: { left: number; top: number; width: number; height: number } | null,
) {
  const base = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  return (
    block
      ? base.composite([
          {
            input: {
              create: {
                width: block.width,
                height: block.height,
                channels: 4,
                background: { r: 255, g: 128, b: 104, alpha: 1 },
              },
            },
            left: block.left,
            top: block.top,
          },
        ])
      : base
  )
    .png()
    .toBuffer();
}

async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * 4;
  return [data[at], data[at + 1], data[at + 2], data[at + 3]];
}

const source = async (width: number, height: number) =>
  orientSource(
    await sharp({
      create: { width, height, channels: 3, background: { r: 20, g: 120, b: 220 } },
    })
      .png()
      .toBuffer(),
    "image/png",
  );

describe("inpaint masks", () => {
  it("scales the studio mask to the source and counts what is painted", async () => {
    // Drawn at half size, as the studio does for big pictures.
    const mask = await readPaintedMask(
      await paintedPng(50, 40, { left: 0, top: 0, width: 25, height: 20 }),
      100,
      80,
    );
    expect(mask.width).toBe(100);
    expect(mask.height).toBe(80);
    expect(mask.coverage).toBeCloseTo(0.25, 1);
    expect(mask.painted[0]).toBe(255);
    expect(mask.painted[100 * 80 - 1]).toBe(0);
  });

  it("refuses a mask with nothing painted, before anything is sent", async () => {
    await expect(
      readPaintedMask(await paintedPng(64, 64, null), 64, 64),
    ).rejects.toBeInstanceOf(BillingGuardError);
    await expect(
      readPaintedMask(await paintedPng(64, 64, null), 64, 64),
    ).rejects.toThrow("先在图上涂出要修改的地方");
  });

  it("refuses something that is not an image", async () => {
    await expect(
      readPaintedMask(Buffer.from("not a png"), 64, 64),
    ).rejects.toBeInstanceOf(BillingGuardError);
  });

  it("reads a mask without alpha by brightness", async () => {
    const bw = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "black" },
    })
      .composite([
        {
          input: {
            create: { width: 20, height: 40, channels: 3, background: "white" },
          },
          left: 20,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const mask = await readPaintedMask(bw, 40, 40);
    expect(mask.coverage).toBeCloseTo(0.5, 2);
    expect(mask.painted[0]).toBe(0);
    expect(mask.painted[39]).toBe(255);
  });

  it("gives OpenAI a mask that is transparent exactly where painted", async () => {
    const mask = await readPaintedMask(
      await paintedPng(100, 80, { left: 0, top: 0, width: 50, height: 80 }),
      100,
      80,
    );
    const png = await openaiMaskPng(mask);
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height, meta.format, meta.hasAlpha]).toEqual([
      100,
      80,
      "png",
      true,
    ]);
    expect((await pixel(png, 10, 10))[3]).toBe(0);
    expect((await pixel(png, 90, 10))[3]).toBe(255);
  });

  it("highlights the painted area for Gemini and leaves the rest alone", async () => {
    const picture = await source(100, 80);
    const mask = await readPaintedMask(
      await paintedPng(100, 80, { left: 0, top: 0, width: 50, height: 80 }),
      100,
      80,
    );
    const copy = await highlightedCopy(picture, mask);
    expect(copy.mimeType).toBe("image/jpeg");
    const [r1, , b1] = await pixel(copy.bytes, 10, 40);
    const [r2, , b2] = await pixel(copy.bytes, 90, 40);
    // Tinted towards magenta on the left, the source's blue on the right.
    expect(r1).toBeGreaterThan(100);
    expect(r2).toBeLessThan(40);
    expect(b2).toBeGreaterThan(200);
    expect(b1).toBeGreaterThan(150);
  });
});

describe("outpaint frames", () => {
  it("widens a square picture to 16:9 around its centre", async () => {
    const frame = frameFor({ width: 1024, height: 1024 }, "16:9", {
      scale: 1,
      anchor: "center",
    });
    expect(frame).toEqual({
      width: 1820,
      height: 1024,
      left: 398,
      top: 0,
      sourceWidth: 1024,
      sourceHeight: 1024,
    });
  });

  it("zooms out and keeps the frame under 2048 px", () => {
    expect(
      frameFor({ width: 2048, height: 2048 }, "1:1", {
        scale: 2,
        anchor: "bottom-right",
      }),
    ).toEqual({
      width: 2048,
      height: 2048,
      left: 1024,
      top: 1024,
      sourceWidth: 1024,
      sourceHeight: 1024,
    });
  });

  it("refuses a frame that adds nothing", () => {
    expect(() =>
      frameFor({ width: 1024, height: 768 }, "4:3", {
        scale: 1,
        anchor: "center",
      }),
    ).toThrow(BillingGuardError);
  });

  it("builds the transparent frame, its mask with a blend band, and the gray frame", async () => {
    const picture = await source(200, 200);
    const frame = frameFor(picture, "2:1", { scale: 1, anchor: "left" });
    expect(frame).toMatchObject({ width: 400, height: 200, left: 0, top: 0 });
    const { image, mask, framed } = await outpaintImages(picture, frame);
    // New area: transparent in the image and the mask, gray in Gemini's copy.
    expect((await pixel(image, 300, 100))[3]).toBe(0);
    expect((await pixel(mask, 300, 100))[3]).toBe(0);
    const [r, g, b] = await pixel(framed, 300, 100);
    expect([r, g, b].every((v) => Math.abs((v ?? 0) - 128) < 6)).toBe(true);
    // The picture is kept; only a thin band at its new right edge may change.
    expect((await pixel(image, 100, 100))[3]).toBe(255);
    expect((await pixel(mask, 100, 100))[3]).toBe(255);
    expect((await pixel(mask, 0, 100))[3]).toBe(255);
    expect((await pixel(mask, 199, 100))[3]).toBe(0);
  });
});

describe("edit prompts", () => {
  it("keeps the user's words at the end, unchanged", () => {
    const words = "把杯子换成红色 [[mock:delay=10]]";
    for (const vendor of ["openai", "gemini"] as const) {
      expect(
        editPrompt({ mode: "inpaint", mask: "m" }, words, vendor).endsWith(
          words,
        ),
      ).toBe(true);
      expect(
        editPrompt(
          { mode: "outpaint", scale: 1.5, anchor: "center" },
          words,
          vendor,
        ).endsWith(words),
      ).toBe(true);
    }
    expect(
      editPrompt({ mode: "inpaint", mask: "m" }, words, "gemini"),
    ).toContain("magenta");
    expect(
      editPrompt({ mode: "outpaint", scale: 1, anchor: "top" }, words, "gemini"),
    ).toContain("gray");
  });
});
