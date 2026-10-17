"use client";

import { UPLOAD_MAX_BYTES } from "@loomic/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ReferenceImageError,
  isCandidateImageType,
  prepareReferenceImage,
} from "../lib/reference-image";
import { ApiApplicationError, ApiAuthError, uploadFile } from "../lib/server-api";

export { ATTACHMENT_ACCEPT } from "../lib/reference-image";

export type ImageAttachmentState = {
  id: string;
  file?: File;
  preview: string;
  /** Being shrunk (lib/reference-image.ts) or uploaded. */
  uploading: boolean;
  /** Shown to the user. */
  error?: string;
  /** With an error: false when trying again cannot help (too large, not a picture). */
  retryable?: boolean;
  assetId?: string;
  url?: string;
  mimeType: string;
  source: "upload" | "canvas-ref";
  name?: string;
};

export type CanvasImageRef = {
  assetId: string;
  url: string;
  mimeType: string;
  name?: string;
};

/** A fully-uploaded attachment ready to be sent, including its origin source. */
export type ReadyAttachment = {
  assetId: string;
  url: string;
  mimeType: string;
  source: "upload" | "canvas-ref";
  name?: string;
};

/**
 * Images selected on the canvas, as attachments for the next message. Each
 * keeps its Storage URL (the agent's image job fetches it from there) and its
 * canvas caption as the chip name; images already attached are skipped.
 */
export function canvasSelectionAttachments(
  elements: ReadonlyArray<{
    id: string;
    type: string;
    fileId?: string;
    storageUrl?: string;
    dataUrl?: string;
    title?: string;
  }>,
  attachedIds: ReadonlySet<string>,
): ReadyAttachment[] {
  return elements
    .filter(
      (el) =>
        el.type === "image" &&
        el.fileId &&
        (el.storageUrl || el.dataUrl) &&
        !attachedIds.has(el.id),
    )
    .map((el, i) => ({
      assetId: el.id,
      url: (el.storageUrl || el.dataUrl) as string,
      mimeType: "image/png",
      source: "canvas-ref" as const,
      name: el.title ?? `画布图片 ${i + 1}`,
    }));
}

/**
 * What an attachment that did not make it says, and whether 重试 can help.
 * Through 0.0.16 every failure read 「上传失败，点击重试」, including a
 * picture too large to ever go through.
 */
export function describeAttachmentFailure(error: unknown): {
  message: string;
  retryable: boolean;
} {
  if (error instanceof ReferenceImageError)
    return { message: error.message, retryable: false };
  if (error instanceof ApiAuthError)
    return { message: "登录已过期，重新登录后再传", retryable: true };
  if (error instanceof ApiApplicationError) {
    // 413 without our code is a proxy in front of the API.
    if (error.code === "file_too_large" || error.status === 413)
      return {
        message: `图片超过 ${Math.floor(UPLOAD_MAX_BYTES / (1024 * 1024))} MB，换一张小一点的`,
        retryable: false,
      };
    if (error.code === "project_not_found")
      return { message: "项目已经不在了，刷新页面后再传", retryable: false };
    if (error.status === 400)
      return { message: "这张图片上传不了，换一张试试", retryable: false };
  }
  return { message: "上传失败，点击重试", retryable: true };
}

/**
 * Why a message with these attachments cannot be sent yet, or null. Only
 * uploaded pictures go with a message; one that failed was dropped without
 * a word by the chat panel through 0.0.16.
 */
export function attachmentsBlocker(
  attachments: readonly ImageAttachmentState[] | undefined,
  /** What the button does: 发送 (chat, home) or 生成 (studio). */
  verb = "发送",
): { tone: "wait" | "alert"; message: string } | null {
  if (!attachments?.length) return null;
  if (attachments.some((a) => a.uploading))
    return { tone: "wait", message: `图片还在上传，传完就能${verb}` };
  const failed = attachments.filter((a) => a.error);
  const first = failed[0];
  if (!first) return null;
  if (failed.length === 1 && first.retryable === false)
    return { tone: "alert", message: `${first.error}（移除这张图片就能${verb}）` };
  const which = failed.length > 1 ? `有 ${failed.length} 张图片` : "有一张图片";
  return failed.every((a) => a.retryable === false)
    ? { tone: "alert", message: `${which}用不了，移除后再${verb}` }
    : {
        tone: "alert",
        message: `${which}没传上去，点图片上的「重试」或移除后再${verb}`,
      };
}

export function useImageAttachments(
  accessToken: string,
  projectId?: string,
  options?: {
    /** A picture could not be attached: a message for a toast. */
    onReject?: (message: string) => void;
  },
) {
  const onRejectRef = useRef(options?.onReject);
  onRejectRef.current = options?.onReject;
  const [attachments, setAttachments] = useState<ImageAttachmentState[]>([]);
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  // Use a ref mirror of attachments for retryUpload to avoid stale closures.
  // Without this, retryUpload would capture a snapshot of `attachments` at
  // the time it was called, potentially missing concurrent state updates.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  // Clean up all object URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      for (const att of attachmentsRef.current) {
        if (att.preview && att.source === "upload") {
          URL.revokeObjectURL(att.preview);
        }
      }
    };
  }, []);

  const patch = useCallback(
    (id: string, update: (a: ImageAttachmentState) => ImageAttachmentState) => {
      setAttachments((prev) => prev.map((a) => (a.id === id ? update(a) : a)));
    },
    [],
  );

  /**
   * Shrinks the picture when it needs it, then uploads it. A retry comes
   * here too, so it gets the same checks (it used to upload the original
   * of a picture refused as too large).
   */
  const attach = useCallback(
    async (id: string, file: File) => {
      try {
        const prepared = await prepareReferenceImage(file);
        // A retry uploads this one; it is not shrunk twice.
        patch(id, (a) => ({ ...a, file: prepared.file, mimeType: prepared.file.type }));
        const res = await uploadFile(
          accessTokenRef.current,
          prepared.file,
          projectIdRef.current,
        );
        console.info("[image-attachments] uploaded", {
          bytes: prepared.file.size,
          type: prepared.file.type,
          shrunk: Boolean(prepared.shrunk),
        });
        patch(id, (a) => ({
          ...a,
          uploading: false,
          assetId: res.asset.id,
          url: res.url,
        }));
      } catch (error) {
        const failure = describeAttachmentFailure(error);
        console.warn(
          "[image-attachments] not attached",
          { name: file.name, bytes: file.size, type: file.type, ...failure },
          error,
        );
        patch(id, (a) => ({
          ...a,
          uploading: false,
          error: failure.message,
          retryable: failure.retryable,
        }));
        onRejectRef.current?.(
          failure.retryable
            ? "图片没传上去，可以点图片上的「重试」"
            : failure.message,
        );
      }
    },
    [patch],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const newAttachments: ImageAttachmentState[] = [];

      for (const file of files) {
        // Clearly not a picture generation takes (GIF, SVG, PDF, …): say so
        // and add nothing. Unlabelled files are checked by their bytes.
        if (!isCandidateImageType(file.type)) {
          console.warn("[image-attachments] Rejected file type:", file.type);
          onRejectRef.current?.("只支持 PNG、JPEG、WebP 格式的图片");
          continue;
        }
        const id = crypto.randomUUID();
        newAttachments.push({
          id,
          file,
          preview: URL.createObjectURL(file),
          uploading: true,
          mimeType: file.type,
          source: "upload",
          name: file.name,
        });
        void attach(id, file);
      }

      if (newAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...newAttachments]);
      }
    },
    [attach],
  );

  const addCanvasRef = useCallback((ref: CanvasImageRef) => {
    const id = crypto.randomUUID();
    setAttachments((prev) => [
      ...prev,
      {
        id,
        preview: ref.url,
        uploading: false,
        assetId: ref.assetId,
        url: ref.url,
        mimeType: ref.mimeType,
        source: "canvas-ref",
        ...(ref.name ? { name: ref.name } : {}),
      },
    ]);
  }, []);

  const retryUpload = useCallback(
    (id: string) => {
      // Read from ref to get the latest attachments state, avoiding stale closure
      const att = attachmentsRef.current.find((a) => a.id === id);
      if (!att?.file || att.uploading || att.retryable === false) return;
      const file = att.file;
      patch(id, (a) => {
        const { error: _error, retryable: _retryable, ...rest } = a;
        return { ...rest, uploading: true };
      });
      void attach(id, file);
    },
    [attach, patch],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.preview && att.source === "upload") {
        URL.revokeObjectURL(att.preview);
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setAttachments((prev) => {
      for (const att of prev) {
        if (att.preview && att.source === "upload") {
          URL.revokeObjectURL(att.preview);
        }
      }
      return [];
    });
  }, []);

  const isUploading = attachments.some((a) => a.uploading);

  // Memoized: the chat panel's send handler depends on it, and a new array
  // on every render re-created that handler on every render.
  const readyAttachments = useMemo<ReadyAttachment[]>(
    () =>
      attachments
        .filter((a) => a.assetId && a.url && !a.error)
        .map((a) => ({
          assetId: a.assetId!,
          url: a.url!,
          mimeType: a.mimeType,
          source: a.source,
          ...(a.name ? { name: a.name } : {}),
        })),
    [attachments],
  );

  return {
    attachments,
    addFiles,
    addCanvasRef,
    retryUpload,
    removeAttachment,
    clearAll,
    isUploading,
    readyAttachments,
  };
}
