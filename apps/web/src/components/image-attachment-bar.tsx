"use client";

import { CheckIcon, CircleAlertIcon, ImageIcon, RotateCwIcon, XIcon } from "lucide-react";

import {
  type ImageAttachmentState,
  attachmentsBlocker,
  attachmentsProgress,
} from "../hooks/use-image-attachments";
import { cn } from "../lib/utils";
import { UploadRing } from "./upload-ring";

/** How long after an upload its check mark is still worth showing. */
const DONE_SHOWN_MS = 1500;

/**
 * Over a thumbnail while its picture is on its way: 压缩中 with a band of
 * light, then a ring filling with the real upload progress, then a check
 * that pops and fades. Through 0.0.17 it was one 8 px pulsing dot for the
 * whole 10–37 s, which read as stuck. `className` gives the thumbnail's
 * corner radius.
 */
export function AttachmentUploadOverlay({
  att,
  className,
}: {
  att: ImageAttachmentState;
  className?: string;
}) {
  if (att.uploading) {
    const preparing = att.phase === "preparing" || att.phase === undefined;
    const percent =
      att.phase === "uploading" && typeof att.progress === "number"
        ? Math.min(99, Math.round(att.progress * 100))
        : null;
    const label = preparing
      ? "正在压缩"
      : att.phase === "queued"
        ? "等待上传"
        : percent !== null
          ? `上传中 ${percent}%`
          : "上传中";
    return (
      <div
        role="status"
        aria-label={label}
        className={cn(
          "absolute inset-0 flex flex-col items-center justify-center gap-0.5 overflow-hidden bg-ground/65 text-fg backdrop-blur-[1px]",
          className,
        )}
      >
        {preparing ? (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-0">
              <span className="absolute inset-0 animate-shimmer-scan bg-gradient-to-r from-transparent via-acc/25 to-transparent" />
            </span>
            <span className="relative text-[10.5px] font-semibold leading-none">
              压缩中
            </span>
          </>
        ) : (
          <span className="relative flex items-center justify-center text-acc">
            <UploadRing
              progress={att.phase === "uploading" ? (att.progress ?? null) : null}
              size={30}
              stroke={3}
            />
            {percent !== null ? (
              <span className="numeral absolute text-[9.5px] font-semibold text-fg">
                {percent}
              </span>
            ) : null}
          </span>
        )}
      </div>
    );
  }
  if (!att.error && att.uploadedAt && Date.now() - att.uploadedAt < DONE_SHOWN_MS) {
    return (
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center",
          className,
        )}
      >
        <span className="animate-upload-done flex size-7 items-center justify-center rounded-full bg-acc text-acc-ink shadow-acc">
          <CheckIcon className="size-4" strokeWidth={3} />
        </span>
      </div>
    );
  }
  return null;
}

type ImageAttachmentBarProps = {
  attachments: ImageAttachmentState[];
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
};

export function ImageAttachmentBar({ attachments, onRemove, onRetry }: ImageAttachmentBarProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto px-1 py-1.5">
      {attachments.map((att) => (
        <div
          key={att.id}
          className="group relative size-14 shrink-0 overflow-visible rounded-frame bg-tint/[0.05]"
        >
          {att.preview ? (
            <img
              src={att.preview}
              alt={att.name ?? "附件图片"}
              className="size-full rounded-frame object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <ImageIcon className="size-5 text-fg-muted" strokeWidth={1.5} />
            </div>
          )}

          <AttachmentUploadOverlay att={att} className="rounded-frame" />

          {att.error &&
            // 重试 only where it can help: a picture too large or not a
            // picture fails the same way every time (the reason is spelled
            // out under the bar by the input that shows it).
            (onRetry && att.file && att.retryable !== false ? (
              <button
                type="button"
                onClick={() => onRetry(att.id)}
                title={att.error}
                aria-label={`${att.error}，重试`}
                className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-frame bg-alert-wash text-alert"
              >
                <RotateCwIcon className="size-3.5" />
                <span className="text-[11px] font-medium">重试</span>
              </button>
            ) : (
              <div
                role="img"
                title={att.error}
                aria-label={att.error}
                className="absolute inset-0 flex items-center justify-center rounded-frame bg-alert-wash text-alert"
              >
                <CircleAlertIcon className="size-4" strokeWidth={2} />
              </div>
            ))}

          <button
            type="button"
            onClick={() => onRemove(att.id)}
            aria-label="移除图片"
            className={cn(
              "absolute -top-1.5 -right-1.5 size-5 items-center justify-center rounded-full bg-fg text-ground group-hover:flex focus-visible:flex",
              // A failed picture has to go before sending; touch screens
              // have no hover to reveal this.
              att.error ? "flex" : "hidden",
            )}
          >
            <XIcon className="size-3" strokeWidth={2.5} />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Says, under the attachments, why the message cannot be sent yet: how far
 * the pictures on their way are (with a bar filling as they go up), or a
 * picture that did not make it (its reason, not only a tooltip, which
 * phones never show). `nudge` changing shakes it once: 发送 was pressed
 * while it still stands in the way.
 */
export function AttachmentNotice({
  attachments,
  verb,
  queued,
  nudge,
  className,
}: {
  attachments: readonly ImageAttachmentState[] | undefined;
  verb?: string;
  /** 发送 was pressed: the message goes once the pictures are up. */
  queued?: boolean;
  nudge?: number;
  className?: string;
}) {
  const blocker = attachmentsBlocker(attachments, verb, { queued: Boolean(queued) });
  if (!blocker) return null;
  const progress = blocker.tone === "wait" ? attachmentsProgress(attachments) : null;
  return (
    <div
      // Remounted on each nudge so the shake plays again.
      key={nudge ? `nudge-${nudge}` : "notice"}
      role={blocker.tone === "alert" ? "alert" : "status"}
      className={cn(
        "flex items-center gap-2 text-[12px] leading-snug",
        blocker.tone === "alert" ? "text-alert" : queued ? "text-acc-text" : "text-fg-soft",
        nudge ? "animate-nudge" : null,
        className,
      )}
    >
      {progress ? (
        <UploadRing
          progress={progress.phase === "uploading" ? progress.fraction : null}
          size={14}
          stroke={2}
          className="text-acc"
        />
      ) : null}
      <span className="min-w-0 flex-1">{blocker.message}</span>
    </div>
  );
}
