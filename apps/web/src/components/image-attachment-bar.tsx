"use client";

import { ImageIcon, RotateCwIcon, XIcon } from "lucide-react";

import type { ImageAttachmentState } from "../hooks/use-image-attachments";
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
          className="group relative size-14 shrink-0 overflow-visible rounded-frame bg-white/[0.05]"
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

          {att.error && (
            <button
              type="button"
              disabled={!(onRetry && att.file)}
              onClick={onRetry && att.file ? () => onRetry(att.id) : undefined}
              title={att.error}
              aria-label={att.error}
              className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-frame bg-alert-wash text-alert"
            >
              <RotateCwIcon className="size-3.5" />
              {onRetry && att.file ? <span className="text-[11px] font-medium">重试</span> : null}
            </button>
          )}

          <button
            type="button"
            onClick={() => onRemove(att.id)}
            aria-label="移除图片"
            className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-fg text-ground group-hover:flex focus-visible:flex"
          >
            <XIcon className="size-3" strokeWidth={2.5} />
          </button>
        </div>
      ))}
    </div>
  );
}
