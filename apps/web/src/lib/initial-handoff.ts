import type { ImageGenerationPreference } from "@loomic/shared";

import type { ReadyAttachment } from "../hooks/use-image-attachments";

/**
 * The first message of a canvas started on the home page. The prompt travels
 * in the URL (`/canvas?id=…&prompt=…`); its pictures, image-model preference
 * and chat model wait in sessionStorage. use-create-project stashes them, the
 * canvas's chat panel takes them at the moment the message goes out
 * (chat-sidebar.tsx). Taking them any earlier lost them: the panel re-renders
 * before it can send, and on 2026-10-16 three first messages on
 * image.gguuai.com went out without the picture that had been uploaded.
 */
export const INITIAL_ATTACHMENTS_KEY = "xy:initial-attachments";
export const INITIAL_IMAGE_GENERATION_PREFERENCE_KEY =
  "xy:initial-image-generation-preference";
export const INITIAL_AGENT_MODEL_KEY = "xy:initial-agent-model";

export type InitialHandoff = {
  attachments?: ReadyAttachment[];
  imageGenerationPreference?: ImageGenerationPreference;
  agentModel?: string;
};

function write(key: string, value: string | undefined) {
  if (value === undefined) sessionStorage.removeItem(key);
  else sessionStorage.setItem(key, value);
}

/** Replaces whatever an earlier, unsent first message left behind. */
export function stashInitialHandoff(handoff: InitialHandoff): void {
  try {
    write(
      INITIAL_ATTACHMENTS_KEY,
      handoff.attachments?.length
        ? JSON.stringify(handoff.attachments)
        : undefined,
    );
    write(
      INITIAL_IMAGE_GENERATION_PREFERENCE_KEY,
      handoff.imageGenerationPreference
        ? JSON.stringify(handoff.imageGenerationPreference)
        : undefined,
    );
    write(INITIAL_AGENT_MODEL_KEY, handoff.agentModel);
  } catch (error) {
    // Storage can be unavailable (private mode, quota): the prompt still
    // travels in the URL, only its pictures and preferences are lost.
    console.warn("[initial-handoff] could not stash the first message", error);
  }
}

function readJson<T>(key: string): T | undefined {
  const raw = sessionStorage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[initial-handoff] ignored a malformed ${key}`);
    return undefined;
  }
}

/**
 * Reads and clears the stash. Call it only when the first message is being
 * sent right now, in the same tick: a stash taken by a pass that then did
 * not send is gone for the pass that does.
 */
export function takeInitialHandoff(): InitialHandoff {
  try {
    const attachments = readJson<ReadyAttachment[]>(INITIAL_ATTACHMENTS_KEY);
    const imageGenerationPreference = readJson<ImageGenerationPreference>(
      INITIAL_IMAGE_GENERATION_PREFERENCE_KEY,
    );
    const agentModel =
      sessionStorage.getItem(INITIAL_AGENT_MODEL_KEY) ?? undefined;
    sessionStorage.removeItem(INITIAL_ATTACHMENTS_KEY);
    sessionStorage.removeItem(INITIAL_IMAGE_GENERATION_PREFERENCE_KEY);
    sessionStorage.removeItem(INITIAL_AGENT_MODEL_KEY);
    return {
      ...(Array.isArray(attachments) && attachments.length
        ? { attachments }
        : {}),
      ...(imageGenerationPreference ? { imageGenerationPreference } : {}),
      ...(agentModel ? { agentModel } : {}),
    };
  } catch (error) {
    console.warn(
      "[initial-handoff] could not read the first message's stash",
      error,
    );
    return {};
  }
}
