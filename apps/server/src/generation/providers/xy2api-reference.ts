import { BillingGuardError } from "../../features/xy2api/errors.js";
import { describeErrorForLog } from "../../utils/error-sanitizer.js";
import type { ImageCallContext } from "../types.js";

export async function fetchReferenceImage(
  source: string,
  ctx: ImageCallContext,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const inline =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(source);
  if (inline) {
    const bytes = Buffer.from(inline[2] ?? "", "base64");
    if (bytes.length > 10 * 1024 * 1024)
      throw new BillingGuardError("invalid_input");
    return { bytes, mimeType: inline[1] ?? "image/png" };
  }
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new BillingGuardError("invalid_input");
  }
  if (
    !ctx.assetOrigin ||
    url.origin !== new URL(ctx.assetOrigin).origin ||
    !url.pathname.startsWith("/storage/v1/object/")
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
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 10 * 1024 * 1024) throw new Error("larger than 10 MB");
    return { bytes, mimeType };
  } catch (error) {
    // Path only: signed URLs carry a token in the query.
    console.warn(
      `[reference] ${url.pathname.split("/").slice(0, 6).join("/")}/… unreadable: ${describeErrorForLog(error)}`,
    );
    throw new BillingGuardError(
      "invalid_input",
      400,
      "参考图读取失败，请重新上传",
    );
  }
}
