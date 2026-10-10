"use client";

import { ArrowUpIcon, BoxSelectIcon, ImageIcon, ImagePlusIcon, SlidersHorizontalIcon, SquareIcon, XIcon } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import type { MessageMention } from "@loomic/shared";
import { ATTACHMENT_ACCEPT, type ImageAttachmentState } from "../hooks/use-image-attachments";
import type { CanvasSelectedElement } from "./canvas-editor";
import { useImageModelPreference } from "../hooks/use-image-model-preference";
import { AgentModelSelector } from "./agent-model-selector";
import { ImageAttachmentBar } from "./image-attachment-bar";
import { ImageModelPreferencePopover } from "./image-model-preference";
import { cn } from "../lib/utils";

type ChatInputProps = {
  onSend: (message: string) => void;
  disabled?: boolean;
  /** A run is streaming: the send button becomes a stop button. */
  running?: boolean;
  onStop?: () => void;
  /** Stop was asked for; waiting for the run to end. */
  stopping?: boolean;
  attachments?: ImageAttachmentState[];
  onAddFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onRetryAttachment?: (id: string) => void;
  isUploading?: boolean;
  onAtQuery?: (query: string | null) => void;
  mentions?: MessageMention[];
  onRemoveMention?: (mention: MessageMention) => void;
  selectedCanvasElements?: CanvasSelectedElement[];
};

export type ChatInputHandle = {
  /** Remove the @query text from input after picker selection */
  clearAtQuery: () => void;
  /** Put back a message that could not be sent (unless something new was typed). */
  restore: (text: string) => void;
};

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({
  onSend,
  disabled,
  running,
  onStop,
  stopping,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  onRetryAttachment,
  isUploading,
  onAtQuery,
  mentions,
  onRemoveMention,
  selectedCanvasElements,
}, ref) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { preference } = useImageModelPreference();
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const modelBtnRef = useRef<HTMLButtonElement>(null);

  useImperativeHandle(ref, () => ({
    restore(text: string) {
      setValue((prev) => (prev.trim() ? prev : text));
    },
    clearAtQuery() {
      setValue((prev) => {
        const lastAtIdx = prev.lastIndexOf("@");
        if (lastAtIdx === -1) return prev;
        return prev.slice(0, lastAtIdx);
      });
    },
  }));

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && (!attachments || attachments.length === 0)) || disabled || isUploading) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, isUploading, onSend, attachments]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ignore Enter during IME composition (e.g. Chinese input confirming a candidate)
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // Auto-resize textarea when value changes
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxH = 240; // max-h-60
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxH)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxH ? "auto" : "hidden";
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setValue(newValue);

      if (!onAtQuery) return;

      // Find last @ in text to detect mention mode
      const lastAtIdx = newValue.lastIndexOf("@");
      if (lastAtIdx === -1) {
        onAtQuery(null); // close picker
        return;
      }

      // Only trigger if @ is at start or preceded by whitespace
      const charBefore = lastAtIdx > 0 ? newValue[lastAtIdx - 1] : " ";
      if (charBefore !== " " && charBefore !== "\n" && lastAtIdx !== 0) {
        onAtQuery(null);
        return;
      }

      // Extract query after @
      const query = newValue.slice(lastAtIdx + 1);
      // Close if user typed a space after query (finished mentioning)
      if (query.includes(" ") || query.includes("\n")) {
        onAtQuery(null);
        return;
      }

      onAtQuery(query);
    },
    [onAtQuery],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0 && onAddFiles) {
        onAddFiles(Array.from(files));
      }
      e.target.value = "";
    },
    [onAddFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!onAddFiles) return;
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (files.length > 0) {
        onAddFiles(files);
      }
    },
    [onAddFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!onAddFiles) return;
      const files = Array.from(e.clipboardData.items)
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length > 0) {
        e.preventDefault();
        onAddFiles(files);
      }
    },
    [onAddFiles],
  );

  const hasContent = value.trim().length > 0 || (attachments && attachments.length > 0);

  // Memoize canvas selection summary -- selectedCanvasElements changes on every
  // canvas interaction, but the counts only change when the selection actually differs
  const selectionSummary = useMemo(() => {
    const imageCount = selectedCanvasElements?.filter((el) => el.type === "image").length ?? 0;
    const totalCount = selectedCanvasElements?.length ?? 0;
    return {
      selectionImageCount: imageCount,
      selectionShapeCount: totalCount - imageCount,
      hasSelection: totalCount > 0,
    };
  }, [selectedCanvasElements]);
  const { selectionImageCount, selectionShapeCount, hasSelection } = selectionSummary;

  return (
    <div className="px-3 pb-3">
      <div
        className="flex min-h-[120px] flex-col justify-between gap-2 rounded-lg glass p-2 shadow-subtle transition-[border-color,box-shadow] focus-within:border-tint/25 focus-within:shadow-card"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {hasSelection && (
          <div className="flex items-center gap-2 rounded-md bg-tint/[0.05] px-2.5 py-1.5 text-xs text-fg-soft">
            {selectionImageCount > 0 && (
              <span className="flex items-center gap-1">
                <ImageIcon className="size-3.5" strokeWidth={1.75} />
                {selectionImageCount} 张图片
              </span>
            )}
            {selectionShapeCount > 0 && (
              <span className="flex items-center gap-1">
                <BoxSelectIcon className="size-3.5" strokeWidth={1.75} />
                {selectionShapeCount} 个图形
              </span>
            )}
            <span className="text-fg-muted">已在画布选中，会一起发给助手</span>
          </div>
        )}
        {attachments && onRemoveAttachment && (
          <ImageAttachmentBar
            attachments={attachments}
            onRemove={onRemoveAttachment}
            {...(onRetryAttachment ? { onRetry: onRetryAttachment } : {})}
          />
        )}
        {mentions && mentions.length > 0 && onRemoveMention && (
          <div className="flex flex-wrap items-center gap-1 px-1 py-1">
            {mentions.map((mention) => (
              <button
                key={`${mention.mentionType}:${mention.id}`}
                type="button"
                onClick={() => onRemoveMention(mention)}
                className="inline-flex items-center gap-1 rounded-sm border border-line bg-tint/[0.05] px-2 py-1 text-[11.5px] text-fg transition-colors hover:border-line-strong"
                title="移除引用"
              >
                <span className="text-fg-muted">@</span>
                <span className="max-w-[180px] truncate">{mention.label}</span>
                <XIcon className="size-3 text-fg-muted" />
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          data-chat-input
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="说说你想做什么，输入 @ 引用画布图片或品牌素材"
          aria-label="输入消息"
          rows={1}
          style={{ scrollbarWidth: "none" }}
          className="min-h-[48px] max-h-60 resize-none bg-transparent px-1.5 pt-1 text-sm leading-[1.75] text-fg placeholder:text-fg-muted focus:outline-none [&::-webkit-scrollbar]:hidden"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            {onAddFiles && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ATTACHMENT_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-soft transition-colors hover:bg-tint/[0.06] hover:text-fg"
                  title="添加图片"
                  aria-label="添加图片"
                >
                  <ImagePlusIcon className="size-4" strokeWidth={1.75} />
                </button>
              </>
            )}
            <AgentModelSelector compact />
            <div className="relative">
              <button
                ref={modelBtnRef}
                type="button"
                onClick={() => setModelPopoverOpen((prev) => !prev)}
                title="生图模型偏好"
                aria-label="生图模型偏好"
                className={cn(
                  "flex size-8 items-center justify-center rounded-md transition-colors",
                  preference.mode === "manual"
                    ? "bg-fg text-ground"
                    : "text-fg-soft hover:bg-tint/[0.06] hover:text-fg",
                )}
              >
                <SlidersHorizontalIcon className="size-4" strokeWidth={1.75} />
              </button>
              <ImageModelPreferencePopover
                open={modelPopoverOpen}
                onClose={() => setModelPopoverOpen(false)}
                anchorRef={modelBtnRef}
              />
            </div>
          </div>
          {running && onStop ? (
            <button
              type="button"
              onClick={onStop}
              disabled={stopping}
              aria-label={stopping ? "正在停止" : "停止"}
              title={stopping ? "正在停止" : "停止"}
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line-strong text-fg transition-colors hover:bg-tint/[0.08] disabled:cursor-wait disabled:opacity-60"
            >
              <SquareIcon className="size-3.5" fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || !hasContent || isUploading}
              aria-label="发送"
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-fg text-ground transition-colors hover:bg-fg/88 disabled:cursor-not-allowed disabled:bg-line-strong"
            >
              <ArrowUpIcon className="size-4" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
