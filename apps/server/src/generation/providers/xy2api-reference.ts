import sharp from "sharp";
import { BillingGuardError } from "../../features/xy2api/errors.js";
import { describeErrorForLog } from "../../utils/error-sanitizer.js";
import type { ImageCallContext } from "../types.js";

// 4K results are 12–15 MB (pre-launch site: Gemini 3584x4800 JPEG 12.4 MB,
// gpt-image-2 2480x3312 PNG 15.2 MB). With a 10 MB cap on references,
// 以此为参考, 变体, 局部重绘, 扩图 and the assistant all refused them.
// Read up to 40 MB; anything over 8 MB is shrunk before it is sent on.
const READ_LIMIT = 40 * 1024 * 1024;
const SEND_LIMIT = 8 * 1024 * 1024;

type ReferenceImage = { bytes: Buffer; mimeType: string };

/**
 * A reference small enough to send: unchanged up to `limit`, otherwise
 * auto-oriented and fitted inside 3072 px (then 2048 px) on the long edge.
 * Photos become JPEG; pictures with transparency stay PNG. Masks are scaled
 * to their source after this (mask-edit.ts), so edits stay aligned.
 */
export async function shrinkForSending(
  image: ReferenceImage,
  limit = SEND_LIMIT,
): Promise<ReferenceImage> {
  if (image.bytes.length <= limit) return image;
  const { hasAlpha } = await sharp(image.bytes).metadata();
  let out = image;
  for (const edge of [3072, 2048]) {
    const resized = sharp(image.bytes)
      .rotate()
      .resize(edge, edge, { fit: "inside", withoutEnlargement: true });
    out = hasAlpha
      ? { bytes: await resized.png().toBuffer(), mimeType: "image/png" }
      : {
          bytes: await resized.jpeg({ quality: 90 }).toBuffer(),
          mimeType: "image/jpeg",
        };
    if (out.bytes.length <= limit) break;
  }
  console.info(
    `[reference] shrank a ${(image.bytes.length / 1048576).toFixed(1)} MB ${image.mimeType} to ${(out.bytes.length / 1048576).toFixed(1)} MB ${out.mimeType}`,
  );
  if (out.bytes.length > limit)
    throw new Error("still too large after shrinking");
  return out;
}

export async function fetchReferenceImage(
  source: string,
  ctx: ImageCallContext,
): Promise<ReferenceImage> {
  const inline =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(source);
  if (inline) {
    const bytes = Buffer.from(inline[2] ?? "", "base64");
    if (bytes.length > READ_LIMIT) throw new BillingGuardError("invalid_input");
    try {
      return await shrinkForSending({
        bytes,
        mimeType: inline[1] ?? "image/png",
      });
    } catch (error) {
      console.warn(
        `[reference] inline image unusable: ${describeErrorForLog(error)}`,
      );
      throw new BillingGuardError("invalid_input");
    }
  }
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new BillingGuardError("invalid_input");
  }
  // ctx.assetOrigin is SUPABASE_URL, which may carry a path: a single-domain
  // deployment serves Supabase under /supabase (the pre-launch site did, and
  // every reference was refused here). Same rule as /api/proxy-image.
  const base = ctx.assetOrigin ? new URL(ctx.assetOrigin) : null;
  const basePath = base?.pathname.replace(/\/$/, "") ?? "";
  const objectPath = url.pathname.slice(basePath.length);
  if (
    !base ||
    url.origin !== base.origin ||
    !url.pathname.startsWith(`${basePath}/storage/v1/object/`) ||
    // Encoded dots, slashes and backslashes could step out of the object
    // route once a proxy in front of Storage decodes them.
    /%2e|%2f|%5c|\\/i.test(url.pathname)
  )
    throw new BillingGuardError(
      "invalid_input",
      400,
      "请先上传参考图到当前工作区",
    );
  try {
    // The origin check above is on the public URL; the fetcher may still
    // route it internally (ctx.assetFetch).
    const response = await (ctx.assetFetch ?? fetch)(url, {
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (
      !response.ok ||
      !["image/png", "image/jpeg", "image/webp"].includes(mimeType)
    ) {
      await response.body?.cancel();
      throw new Error(`status ${response.status}, type ${mimeType || "none"}`);
    }
    if (Number(response.headers.get("content-length")) > READ_LIMIT) {
      await response.body?.cancel();
      throw new Error("larger than 40 MB");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > READ_LIMIT) throw new Error("larger than 40 MB");
    return await shrinkForSending({ bytes, mimeType });
  } catch (error) {
    // Path only: signed URLs carry a token in the query.
    console.warn(
      `[reference] ${objectPath.split("/").slice(0, 6).join("/")}/… unreadable: ${describeErrorForLog(error)}`,
    );
    throw new BillingGuardError(
      "invalid_input",
      400,
      "参考图读取失败，请重新上传",
    );
  }
}
