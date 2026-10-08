"use client";

import type { ImageGenerationPreference } from "@loomic/shared";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { useToast } from "@/components/toast";
import type { ReadyAttachment } from "@/hooks/use-image-attachments";
import { useAuth } from "@/lib/auth-context";
import { ApiAuthError, createProject } from "@/lib/server-api";

/** sessionStorage keys used to hand the first prompt from Home to the canvas. */
export const INITIAL_ATTACHMENTS_KEY = "xy:initial-attachments";
export const INITIAL_IMAGE_GENERATION_PREFERENCE_KEY =
  "xy:initial-image-generation-preference";
export const INITIAL_AGENT_MODEL_KEY = "xy:initial-agent-model";

function stash(key: string, value: string | undefined) {
  try {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode quotas); the prompt still
    // travels in the URL, only attachments/preferences are lost.
  }
}

/**
 * Create a project and open its canvas in the same tab. When a prompt is
 * given, the canvas auto-sends it to the design agent once.
 */
export function useCreateProject() {
  const { session } = useAuth();
  const router = useRouter();
  const { error: toastError } = useToast();
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  const create = useCallback(
    async (opts?: {
      prompt?: string;
      name?: string;
      attachments?: ReadyAttachment[];
      imageGenerationPreference?: ImageGenerationPreference;
      model?: string;
    }) => {
      const token = session?.access_token;
      if (!token || creatingRef.current) return;
      creatingRef.current = true;
      setCreating(true);

      stash(
        INITIAL_ATTACHMENTS_KEY,
        opts?.attachments?.length ? JSON.stringify(opts.attachments) : undefined,
      );
      stash(
        INITIAL_IMAGE_GENERATION_PREFERENCE_KEY,
        opts?.imageGenerationPreference
          ? JSON.stringify(opts.imageGenerationPreference)
          : undefined,
      );
      stash(INITIAL_AGENT_MODEL_KEY, opts?.model);

      try {
        const name =
          opts?.name ??
          (opts?.prompt ? opts.prompt.trim().slice(0, 24) : "未命名项目");
        const result = await createProject(token, { name: name || "未命名项目" });
        const canvasId = result.project.primaryCanvas.id;
        const url = opts?.prompt
          ? `/canvas?id=${canvasId}&prompt=${encodeURIComponent(opts.prompt)}`
          : `/canvas?id=${canvasId}`;
        router.push(url);
      } catch (err) {
        console.error("[create-project] failed", err);
        // 401 is handled globally (auth expiry event); only report others.
        if (!(err instanceof ApiAuthError)) toastError("项目创建失败，请稍后再试");
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [session?.access_token, toastError, router],
  );

  return { create, creating };
}
