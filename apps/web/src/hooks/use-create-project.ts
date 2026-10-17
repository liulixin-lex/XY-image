"use client";

import type { ImageGenerationPreference } from "@loomic/shared";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { useToast } from "@/components/toast";
import type { ReadyAttachment } from "@/hooks/use-image-attachments";
import { useAuth } from "@/lib/auth-context";
import { stashInitialHandoff } from "@/lib/initial-handoff";
import { ApiAuthError, createProject } from "@/lib/server-api";

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

      // The canvas's chat panel takes these when it sends the prompt.
      stashInitialHandoff({
        ...(opts?.attachments?.length ? { attachments: opts.attachments } : {}),
        ...(opts?.imageGenerationPreference
          ? { imageGenerationPreference: opts.imageGenerationPreference }
          : {}),
        ...(opts?.model ? { agentModel: opts.model } : {}),
      });

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
