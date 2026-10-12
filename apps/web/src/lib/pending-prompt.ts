/**
 * A prompt typed on the landing page before signing in. It survives the
 * login round-trip in sessionStorage and is placed back into the studio
 * input, together with the ratio and 画质 picked on the landing page.
 * 最近生成 (第 56 条) hands pictures to the studio the same way: 再来一次
 * with its model, key and 质量, or 以此为参考 with the picture attached.
 * It is never auto-submitted: generation costs money, so only an explicit
 * click in the studio starts it.
 */
import { IMAGE_QUALITIES, type ImageQuality } from "@loomic/shared";

import {
  type AspectRatio,
  type ImageResolution,
  RESOLUTIONS,
  isAspectRatio,
} from "./image-model-meta";

const KEY = "xy:pending-prompt";

export type PendingDraft = {
  prompt: string;
  aspectRatio?: AspectRatio;
  resolution?: ImageResolution;
  quality?: ImageQuality;
  /** The model, and the key it went through, to pick again. */
  model?: string;
  keyId?: number;
  /** A finished picture to attach as a reference. */
  reference?: { url: string; assetId: string; name: string };
};

export function savePendingDraft(draft: PendingDraft) {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...draft, prompt: draft.prompt.slice(0, 4000) }),
    );
  } catch {
    // ignore storage failures; the user can retype
  }
}

/** Kept for callers that only carry text. */
export function savePendingPrompt(prompt: string) {
  savePendingDraft({ prompt });
}

export function takePendingDraft(): PendingDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    // Older builds stored the bare prompt string.
    if (!raw.startsWith("{")) return { prompt: raw };
    const parsed = JSON.parse(raw) as {
      prompt?: unknown;
      aspectRatio?: unknown;
      resolution?: unknown;
      model?: unknown;
      keyId?: unknown;
      reference?: { url?: unknown; assetId?: unknown; name?: unknown } | null;
      /** Older builds: standard / hd = 1K / 2K. */
      quality?: unknown;
    };
    if (typeof parsed.prompt !== "string") return null;
    const reference =
      parsed.reference &&
      typeof parsed.reference.url === "string" &&
      typeof parsed.reference.assetId === "string"
        ? {
            url: parsed.reference.url,
            assetId: parsed.reference.assetId,
            name: typeof parsed.reference.name === "string" ? parsed.reference.name : "参考图",
          }
        : null;
    // A picture handed over as a reference may come without a description.
    if (!parsed.prompt && !reference) return null;
    const resolution = RESOLUTIONS.includes(parsed.resolution as ImageResolution)
      ? (parsed.resolution as ImageResolution)
      : parsed.quality === "hd"
        ? "2K"
        : parsed.quality === "standard"
          ? "1K"
          : undefined;
    const quality = (IMAGE_QUALITIES as readonly unknown[]).includes(parsed.quality)
      ? (parsed.quality as ImageQuality)
      : undefined;
    return {
      prompt: parsed.prompt,
      ...(isAspectRatio(parsed.aspectRatio) ? { aspectRatio: parsed.aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
      ...(quality ? { quality } : {}),
      ...(typeof parsed.model === "string" && parsed.model ? { model: parsed.model } : {}),
      ...(typeof parsed.keyId === "number" && Number.isInteger(parsed.keyId) ? { keyId: parsed.keyId } : {}),
      ...(reference ? { reference } : {}),
    };
  } catch {
    return null;
  }
}

export function takePendingPrompt(): string | null {
  return takePendingDraft()?.prompt ?? null;
}

/** Only allow same-origin relative paths as post-login destinations. */
export function safeNextPath(raw: string | null | undefined, fallback = "/home") {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}
