"use client";

import { CircleAlertIcon, ImageIcon, RotateCwIcon, XIcon } from "lucide-react";

import {
  type ImageAttachmentState,
  attachmentsBlocker,
} from "../hooks/use-image-attachments";
import { cn } from "../lib/utils";
import { LiveDot } from "./ambient/live-dot";

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

          {att.uploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-frame bg-ground/60">
              <LiveDot />
            </div>
          )}

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
 * Says, under the attachments, why the message cannot be sent yet: still
 * uploading, or a picture that did not make it (its reason, not only a
 * tooltip, which phones never show).
 */
export function AttachmentNotice({
  attachments,
  verb,
  className,
}: {
  attachments: readonly ImageAttachmentState[] | undefined;
  verb?: string;
  className?: string;
}) {
  const blocker = attachmentsBlocker(attachments, verb);
  if (!blocker) return null;
  return (
    <p
      role={blocker.tone === "alert" ? "alert" : "status"}
      className={cn(
        "text-[12px] leading-snug",
        blocker.tone === "alert" ? "text-alert" : "text-fg-muted",
        className,
      )}
    >
      {blocker.message}
    </p>
  );
}
