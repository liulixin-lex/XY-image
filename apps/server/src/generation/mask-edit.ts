import {
  type ImageEdit,
  type OutpaintAnchor,
  type OutpaintFrame,
  aspectRatioValue,
  outpaintFrame,
} from "@loomic/shared";
import sharp from "sharp";
import { BillingGuardError } from "../features/xy2api/errors.js";

/**
 * 局部重绘 / 扩图 for the xy2api image providers. Everything here runs before
 * the main site is called, so a refusal (BillingGuardError) costs nothing.
 *
 * How each vendor is asked:
 * - OpenAI Image API: `images.edit` with the source and a real `mask` (same
 *   size as the source; fully transparent where the model may paint). xy2api
 *   0.2.5 forwards `mask` on all three of its OpenAI paths (API key, Codex
 *   direct, Responses `input_image_mask`). For gpt-image models the mask is
 *   guidance, not a hard stencil, so the prompt says the same thing.
 * - Gemini: no mask parameter. Inpaint sends the source plus a copy with the
 *   area highlighted in magenta; outpaint sends the picture on a flat gray
 *   frame. The prompt explains both.
 */

/** Highlight for the Gemini copy: a colour pictures rarely contain. */
const HIGHLIGHT = { r: 255, g: 0, b: 170 };
const HIGHLIGHT_ALPHA = 0.5;
/** Flat frame around the picture for Gemini 扩图. */
const FRAME_GRAY = { r: 128, g: 128, b: 128 };
/** Below this share of painted pixels there is nothing meaningful to change. */
const MIN_COVERAGE = 0.002;
/** Gemini inline images: keep the request small (both images travel inline). */
const GEMINI_MAX_EDGE = 2048;
/** 扩图 frame long edge; the output size comes from 画质, not from this. */
export const OUTPAINT_MAX_EDGE = 2048;

export type SourceImage = {
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
};

export type PaintedMask = {
  /** One byte per source pixel: 255 painted, 0 not. */
  painted: Buffer;
  width: number;
  height: number;
  coverage: number;
};

/**
 * Applies EXIF orientation (the studio drew the mask on the picture as the
 * browser shows it) and reads the size.
 */
export async function orientSource(
  bytes: Buffer,
  mimeType: string,
): Promise<SourceImage> {
  const meta = await sharp(bytes).metadata();
  const oriented =
    meta.orientation && meta.orientation !== 1
      ? await sharp(bytes).rotate().toBuffer()
      : bytes;
  const { width, height } = await sharp(oriented).metadata();
  if (!width || !height) throw new BillingGuardError("invalid_input");
  return { bytes: oriented, mimeType, width, height };
}

/**
 * The studio's mask (opaque = painted, any size) scaled to the source.
 * A mask whose alpha says nothing (none, or opaque everywhere) is read by
 * brightness instead (white = painted).
 */
export async function readPaintedMask(
  maskBytes: Buffer,
  width: number,
  height: number,
): Promise<PaintedMask> {
  const channel = async (pick: "alpha" | "brightness") => {
    const scaled = sharp(maskBytes).resize(width, height, { fit: "fill" });
    return (
      pick === "alpha"
        ? scaled.ensureAlpha().extractChannel("alpha")
        : scaled.flatten({ background: "black" }).greyscale().extractChannel(0)
    )
      .raw()
      .toBuffer();
  };
  const threshold = (raw: Buffer) => {
    const painted = Buffer.alloc(width * height);
    let count = 0;
    for (let i = 0; i < painted.length; i += 1) {
      if ((raw[i] ?? 0) >= 128) {
        painted[i] = 255;
        count += 1;
      }
    }
    return { painted, coverage: count / painted.length };
  };
  let read: { painted: Buffer; coverage: number };
  try {
    const { hasAlpha } = await sharp(maskBytes).metadata();
    read = threshold(await channel(hasAlpha ? "alpha" : "brightness"));
    if (hasAlpha && read.coverage === 1)
      read = threshold(await channel("brightness"));
  } catch {
    throw new BillingGuardError(
      "invalid_input",
      400,
      "涂抹区域读取失败，请重新涂一次",
    );
  }
  if (read.coverage < MIN_COVERAGE)
    throw new BillingGuardError("invalid_input", 400, "先在图上涂出要修改的地方");
  return { ...read, width, height };
}

/** OpenAI mask: transparent where the model may paint, opaque elsewhere. */
export async function openaiMaskPng(mask: PaintedMask): Promise<Buffer> {
  const alpha = Buffer.alloc(mask.painted.length);
  for (let i = 0; i < alpha.length; i += 1)
    alpha[i] = 255 - (mask.painted[i] ?? 0);
  return sharp({
    create: {
      width: mask.width,
      height: mask.height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .joinChannel(alpha, {
      raw: { width: mask.width, height: mask.height, channels: 1 },
    })
    .png()
    .toBuffer();
}

/** Gemini: the source scaled for inline transport (JPEG unless it fits). */
export async function geminiSource(
  source: SourceImage,
): Promise<{ bytes: Buffer; mimeType: string }> {
  if (Math.max(source.width, source.height) <= GEMINI_MAX_EDGE)
    return { bytes: source.bytes, mimeType: source.mimeType };
  const bytes = await sharp(source.bytes)
    .resize(GEMINI_MAX_EDGE, GEMINI_MAX_EDGE, { fit: "inside" })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { bytes, mimeType: "image/jpeg" };
}

/** Gemini inpaint: the source with the painted area tinted magenta. */
export async function highlightedCopy(
  source: SourceImage,
  mask: PaintedMask,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const alpha = Buffer.alloc(mask.painted.length);
  for (let i = 0; i < alpha.length; i += 1)
    alpha[i] = Math.round((mask.painted[i] ?? 0) * HIGHLIGHT_ALPHA);
  const layer = await sharp({
    create: {
      width: mask.width,
      height: mask.height,
      channels: 3,
      background: HIGHLIGHT,
    },
  })
    .joinChannel(alpha, {
      raw: { width: mask.width, height: mask.height, channels: 1 },
    })
    .png()
    .toBuffer();
  const bytes = await sharp(source.bytes)
    .composite([{ input: layer }])
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(GEMINI_MAX_EDGE, GEMINI_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { bytes, mimeType: "image/jpeg" };
}

/**
 * The 扩图 frame for a request: its aspect ratio (already resolved for the
 * model) around the source. Refused when it would add nothing.
 */
export function frameFor(
  source: Pick<SourceImage, "width" | "height">,
  aspectRatio: string | undefined,
  edit: { scale: number; anchor: OutpaintAnchor },
): OutpaintFrame {
  const ratio = aspectRatio
    ? aspectRatioValue(aspectRatio)
    : source.width / source.height;
  const frame = ratio
    ? outpaintFrame(source, ratio, edit.scale, edit.anchor, OUTPAINT_MAX_EDGE)
    : null;
  if (!frame)
    throw new BillingGuardError(
      "invalid_input",
      400,
      "扩图需要换一个比例或放大一些，现在的设置不会多出画面",
    );
  return frame;
}

/**
 * 扩图 images. `image`: the picture on a transparent frame (OpenAI);
 * `mask`: opaque over the picture except a thin band along its new edges so
 * the seam blends; `framed`: the picture on flat gray (Gemini).
 */
export async function outpaintImages(
  source: SourceImage,
  frame: OutpaintFrame,
): Promise<{ image: Buffer; mask: Buffer; framed: Buffer }> {
  const placed = await sharp(source.bytes)
    .resize(frame.sourceWidth, frame.sourceHeight, { fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();
  const canvas = (background: sharp.RGBA) =>
    sharp({
      create: {
        width: frame.width,
        height: frame.height,
        channels: 4,
        background,
      },
    });
  const image = await canvas({ r: 0, g: 0, b: 0, alpha: 0 })
    .composite([{ input: placed, left: frame.left, top: frame.top }])
    .png()
    .toBuffer();
  // Let the model touch a few pixels of the old edge where new picture meets it.
  const band = Math.max(
    2,
    Math.round(Math.min(frame.sourceWidth, frame.sourceHeight) * 0.015),
  );
  const right = frame.width - frame.left - frame.sourceWidth;
  const bottom = frame.height - frame.top - frame.sourceHeight;
  const inset = {
    left: frame.left > 0 ? band : 0,
    top: frame.top > 0 ? band : 0,
    right: right > 0 ? band : 0,
    bottom: bottom > 0 ? band : 0,
  };
  const keepWidth = Math.max(1, frame.sourceWidth - inset.left - inset.right);
  const keepHeight = Math.max(1, frame.sourceHeight - inset.top - inset.bottom);
  const mask = await canvas({ r: 0, g: 0, b: 0, alpha: 0 })
    .composite([
      {
        input: {
          create: {
            width: keepWidth,
            height: keepHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 1 },
          },
        },
        left: frame.left + inset.left,
        top: frame.top + inset.top,
      },
    ])
    .png()
    .toBuffer();
  const framed = await canvas({ ...FRAME_GRAY, alpha: 1 })
    .composite([{ input: placed, left: frame.left, top: frame.top }])
    .flatten({ background: FRAME_GRAY })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { image, mask, framed };
}

/**
 * What the model is told. The user's words come last and unchanged (the lab
 * mock reads its [[mock:…]] directives from them too).
 */
export function editPrompt(
  edit: ImageEdit,
  userPrompt: string,
  vendor: "openai" | "gemini",
): string {
  if (edit.mode === "inpaint")
    return vendor === "openai"
      ? `Edit only the transparent (masked) area of the image. Keep everything outside it exactly as it is, with the same framing and lighting.\nChange requested: ${userPrompt}`
      : `The first image is the original picture. The second image is the same picture with the area to change highlighted in translucent magenta. Change only that area as requested and keep everything else identical to the original, with the same framing. Return the complete picture without any magenta highlight.\nChange requested: ${userPrompt}`;
  return vendor === "openai"
    ? `Extend the picture outward into the transparent area so it fills the whole frame. Keep the original part unchanged and continue its scene, perspective, lighting and style seamlessly.\nFor the new area: ${userPrompt}`
    : `The image shows a picture on a flat gray frame. Replace all of the gray by extending the scene outward so the picture fills the whole frame. Keep the original part unchanged and continue its scene, perspective, lighting and style seamlessly. Return the complete picture with no gray border.\nFor the new area: ${userPrompt}`;
}
