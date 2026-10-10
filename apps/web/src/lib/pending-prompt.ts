/**
 * A prompt typed on the landing page before signing in. It survives the
 * login round-trip in sessionStorage and is placed back into the studio
 * input, together with the ratio and 画质 picked on the landing page.
 * It is never auto-submitted: generation costs money, so only an explicit
 * click in the studio starts it.
 */
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
      /** Older builds: standard / hd = 1K / 2K. */
      quality?: unknown;
    };
    if (typeof parsed.prompt !== "string" || !parsed.prompt) return null;
    const resolution = RESOLUTIONS.includes(parsed.resolution as ImageResolution)
      ? (parsed.resolution as ImageResolution)
      : parsed.quality === "hd"
        ? "2K"
        : parsed.quality === "standard"
          ? "1K"
          : undefined;
    return {
      prompt: parsed.prompt,
      ...(isAspectRatio(parsed.aspectRatio) ? { aspectRatio: parsed.aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
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
