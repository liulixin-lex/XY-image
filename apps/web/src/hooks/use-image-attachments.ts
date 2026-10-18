"use client";

import { UPLOAD_MAX_BYTES } from "@loomic/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ReferenceImageError,
  isCandidateImageType,
  prepareReferenceImageInBackground,
} from "../lib/reference-image";
import {
  ApiApplicationError,
  ApiAuthError,
  UploadStalledError,
  uploadFileWithProgress,
} from "../lib/server-api";

export { ATTACHMENT_ACCEPT } from "../lib/reference-image";

/**
 * Where a picture on its way is: being shrunk (lib/reference-image.ts),
 * waiting for one of the UPLOAD_CONCURRENCY upload slots, or going up.
 */
export type UploadPhase = "preparing" | "queued" | "uploading";

export type ImageAttachmentState = {
  id: string;
  file?: File;
  preview: string;
  /** Being shrunk (lib/reference-image.ts) or uploaded. */
  uploading: boolean;
  /** With `uploading`: which step it is in. */
  phase?: UploadPhase;
  /** With phase "uploading": share of the bytes sent, 0–1, when known. */
  progress?: number;
  /** When it finished uploading (the thumbnail's check mark plays once). */
  uploadedAt?: number;
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
  if (error instanceof UploadStalledError)
    return { message: "网络太慢，上传停住了，点击重试", retryable: true };
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

export type AttachmentsProgress = {
  /** Pictures still on their way. */
  active: number;
  /** "preparing" while none of them is going up yet. */
  phase: "preparing" | "uploading" | null;
  /** All of them together, 0–1 (shrinking and waiting count as 0), when known. */
  fraction: number | null;
  /** `fraction` as a percentage, at most 99 until the last one is done. */
  percent: number | null;
};

/** How far the pictures on their way have got, for the notice and the buttons. */
export function attachmentsProgress(
  attachments: readonly ImageAttachmentState[] | undefined,
): AttachmentsProgress {
  const active = attachments?.filter((a) => a.uploading) ?? [];
  if (active.length === 0)
    return { active: 0, phase: null, fraction: null, percent: null };
  const phase = active.some((a) => a.phase === "uploading")
    ? "uploading"
    : "preparing";
  const known = active.every(
    (a) => a.phase !== "uploading" || typeof a.progress === "number",
  );
  const fraction = known
    ? active.reduce(
        (sum, a) => sum + (a.phase === "uploading" ? (a.progress ?? 0) : 0),
        0,
      ) / active.length
    : null;
  return {
    active: active.length,
    phase,
    fraction,
    percent: fraction === null ? null : Math.min(99, Math.round(fraction * 100)),
  };
}

/**
 * Why a message with these attachments cannot be sent yet, or null. Only
 * uploaded pictures go with a message; one that failed was dropped without
 * a word by the chat panel through 0.0.16. While pictures are on their way
 * it says how far they are (through 0.0.17 a fixed 「图片还在上传」 sat there
 * for up to half a minute, which read as stuck).
 */
export function attachmentsBlocker(
  attachments: readonly ImageAttachmentState[] | undefined,
  /** What the button does: 发送 (chat, home) or 生成 (studio). */
  verb = "发送",
  options: {
    /** The user already pressed the button: it goes once they are up. */
    queued?: boolean;
  } = {},
): { tone: "wait" | "alert"; message: string } | null {
  if (!attachments?.length) return null;
  const progress = attachmentsProgress(attachments);
  if (progress.active > 0) {
    const what =
      progress.phase === "preparing"
        ? "正在压缩图片"
        : progress.percent !== null
          ? `图片上传中 ${progress.percent}%`
          : "图片上传中";
    const more = progress.active > 1 ? `（${progress.active} 张）` : "";
    const then = options.queued ? `传完自动${verb}` : `传完就能${verb}`;
    return { tone: "wait", message: `${what}${more}，${then}` };
  }
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

/** Pictures going up at once: on a slow line two at full speed beat five crawling. */
export const UPLOAD_CONCURRENCY = 2;

type UploadSlots = { acquire(signal: AbortSignal): Promise<() => void> };

const abortError = () => new DOMException("upload aborted", "AbortError");
const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

/** At most `size` holders at a time; the rest wait in order. */
function createUploadSlots(size: number): UploadSlots {
  let free = size;
  const waiting: Array<() => void> = [];
  const releaser = () => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = waiting.shift();
      if (next) next();
      else free++;
    };
  };
  return {
    async acquire(signal) {
      if (signal.aborted) throw abortError();
      if (free > 0) {
        free--;
        return releaser();
      }
      await new Promise<void>((resolve, reject) => {
        const grant = () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = () => {
          const index = waiting.indexOf(grant);
          if (index >= 0) waiting.splice(index, 1);
          reject(abortError());
        };
        waiting.push(grant);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      return releaser();
    },
  };
}

const elapsed = (since: number) => Math.round(performance.now() - since);

function withoutProgress(a: ImageAttachmentState): ImageAttachmentState {
  const { phase: _phase, progress: _progress, ...rest } = a;
  return rest;
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
  // One upload queue and one abort handle per picture, for this input.
  const [slots] = useState(() => createUploadSlots(UPLOAD_CONCURRENCY));
  const [controllers] = useState(() => new Map<string, AbortController>());

  // Use a ref mirror of attachments for retryUpload to avoid stale closures.
  // Without this, retryUpload would capture a snapshot of `attachments` at
  // the time it was called, potentially missing concurrent state updates.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  // On unmount: stop uploads still going and free the object URLs.
  useEffect(() => {
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      for (const att of attachmentsRef.current) {
        if (att.preview && att.source === "upload") {
          URL.revokeObjectURL(att.preview);
        }
      }
    };
  }, [controllers]);

  const patch = useCallback(
    (id: string, update: (a: ImageAttachmentState) => ImageAttachmentState) => {
      setAttachments((prev) => prev.map((a) => (a.id === id ? update(a) : a)));
    },
    [],
  );

  /**
   * Shrinks the picture when it needs it (in a worker where the browser has
   * one), waits for an upload slot, then uploads it with progress. A retry
   * comes here too, so it gets the same checks (it used to upload the
   * original of a picture refused as too large).
   */
  const attach = useCallback(
    async (id: string, file: File) => {
      controllers.get(id)?.abort();
      const controller = new AbortController();
      controllers.set(id, controller);
      const { signal } = controller;
      const startedAt = performance.now();
      try {
        const prepared = await prepareReferenceImageInBackground(file);
        if (signal.aborted) return;
        const prepMs = elapsed(startedAt);
        // A retry uploads this one; it is not shrunk twice. The thumbnail
        // shows the light copy (a 4032 px original decoded for 56 px).
        const previous = attachmentsRef.current.find((a) => a.id === id);
        const lighter =
          prepared.file !== file && previous?.source === "upload"
            ? URL.createObjectURL(prepared.file)
            : null;
        patch(id, (a) => ({
          ...a,
          file: prepared.file,
          mimeType: prepared.file.type,
          phase: "queued",
          ...(lighter ? { preview: lighter } : {}),
        }));
        if (lighter && previous?.preview) URL.revokeObjectURL(previous.preview);

        const release = await slots.acquire(signal);
        try {
          patch(id, (a) => ({ ...a, phase: "uploading", progress: 0 }));
          const uploadStartedAt = performance.now();
          let shown = 0;
          const res = await uploadFileWithProgress(
            accessTokenRef.current,
            prepared.file,
            {
              ...(projectIdRef.current ? { projectId: projectIdRef.current } : {}),
              signal,
              onProgress: (fraction) => {
                // One render per percent, not per progress event.
                const percent = Math.floor(fraction * 100);
                if (percent === shown) return;
                shown = percent;
                patch(id, (a) =>
                  a.uploading ? { ...a, progress: fraction } : a,
                );
              },
              clientInfo: { originalBytes: file.size, prepMs },
            },
          );
          console.info("[image-attachments] uploaded", {
            bytes: prepared.file.size,
            originalBytes: file.size,
            type: prepared.file.type,
            shrunk: Boolean(prepared.shrunk),
            prepMs,
            uploadMs: elapsed(uploadStartedAt),
          });
          patch(id, (a) => ({
            ...withoutProgress(a),
            uploading: false,
            uploadedAt: Date.now(),
            assetId: res.asset.id,
            url: res.url,
          }));
        } finally {
          release();
        }
      } catch (error) {
        // Removed while on its way: nothing to say.
        if (signal.aborted || isAbort(error)) {
          console.info("[image-attachments] upload stopped: picture removed", {
            name: file.name,
          });
          return;
        }
        const failure = describeAttachmentFailure(error);
        console.warn(
          "[image-attachments] not attached",
          {
            name: file.name,
            bytes: file.size,
            type: file.type,
            afterMs: elapsed(startedAt),
            ...failure,
          },
          error,
        );
        patch(id, (a) => ({
          ...withoutProgress(a),
          uploading: false,
          error: failure.message,
          retryable: failure.retryable,
        }));
        onRejectRef.current?.(
          failure.retryable
            ? "图片没传上去，可以点图片上的「重试」"
            : failure.message,
        );
      } finally {
        if (controllers.get(id) === controller) controllers.delete(id);
      }
    },
    [patch, slots, controllers],
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
          phase: "preparing",
          mimeType: file.type,
          source: "upload",
          name: file.name,
        });
      }

      if (newAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...newAttachments]);
        for (const att of newAttachments) {
          if (att.file) void attach(att.id, att.file);
        }
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
        return { ...rest, uploading: true, phase: "preparing" };
      });
      void attach(id, file);
    },
    [attach, patch],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      // An upload still going stops here instead of using up the line.
      controllers.get(id)?.abort();
      controllers.delete(id);
      setAttachments((prev) => {
        const att = prev.find((a) => a.id === id);
        if (att?.preview && att.source === "upload") {
          URL.revokeObjectURL(att.preview);
        }
        return prev.filter((a) => a.id !== id);
      });
    },
    [controllers],
  );

  const clearAll = useCallback(() => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    setAttachments((prev) => {
      for (const att of prev) {
        if (att.preview && att.source === "upload") {
          URL.revokeObjectURL(att.preview);
        }
      }
      return [];
    });
  }, [controllers]);

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

/**
 * 发送 pressed while pictures are still on their way: instead of a greyed
 * button that does nothing (through 0.0.17), the message waits and goes by
 * itself once they are all up. `send` is the input's own send (it reads the
 * text as it is then). A picture that fails meanwhile cancels the wait; the
 * notice under the pictures says why.
 */
export function useSendWhenUploaded(
  attachments: readonly ImageAttachmentState[] | undefined,
  send: () => void,
) {
  const [queued, setQueued] = useState(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  const uploading = attachments?.some((a) => a.uploading) ?? false;
  const failed = attachments?.some((a) => a.error) ?? false;

  useEffect(() => {
    if (!queued || uploading) return;
    setQueued(false);
    if (failed) {
      console.info("[image-attachments] queued send dropped: a picture did not make it");
      return;
    }
    console.info("[image-attachments] pictures up, sending the waiting message");
    sendRef.current();
  }, [queued, uploading, failed]);

  const queue = useCallback(() => {
    console.info("[image-attachments] send waits for the pictures");
    setQueued(true);
  }, []);
  const cancel = useCallback(() => setQueued(false), []);
  return { queued: queued && uploading, queue, cancel };
}
