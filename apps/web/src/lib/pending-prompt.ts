/**
 * A prompt typed on the landing page before signing in. It survives the
 * login round-trip in sessionStorage and is placed back into the studio
 * input, together with the ratio and quality picked on the landing page.
 * It is never auto-submitted: generation costs money, so only an explicit
 * click in the studio starts it.
 */
import { ASPECT_RATIOS, type AspectRatio } from "./image-model-meta";

const KEY = "xy:pending-prompt";

export type PendingDraft = {
  prompt: string;
  aspectRatio?: AspectRatio;
  quality?: "standard" | "hd";
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
    const parsed = JSON.parse(raw) as Partial<PendingDraft>;
    if (typeof parsed.prompt !== "string" || !parsed.prompt) return null;
    return {
      prompt: parsed.prompt,
      ...(ASPECT_RATIOS.includes(parsed.aspectRatio as AspectRatio)
        ? { aspectRatio: parsed.aspectRatio as AspectRatio }
        : {}),
      ...(parsed.quality === "standard" || parsed.quality === "hd"
        ? { quality: parsed.quality }
        : {}),
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
