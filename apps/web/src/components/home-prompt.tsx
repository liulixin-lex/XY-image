"use client";

/**
 * Home entry box: the first message to the design agent. Submitting creates
 * a canvas project and hands the prompt (plus attachments and model
 * preferences) to that canvas, which sends it exactly once.
 */
import type { ImageGenerationPreference } from "@loomic/shared";
import { ArrowUpIcon, ImagePlusIcon, SlidersHorizontalIcon } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import {
  ATTACHMENT_ACCEPT,
  type ImageAttachmentState,
  type ReadyAttachment,
  attachmentsBlocker,
  attachmentsProgress,
  useSendWhenUploaded,
} from "../hooks/use-image-attachments";
import { useAgentModel } from "../hooks/use-agent-model";
import {
  resolveImagePreference,
  useImageModelPreference,
} from "../hooks/use-image-model-preference";
import { useAccount } from "../lib/account-context";
import { cn } from "../lib/utils";
import { AgentModelSelector } from "./agent-model-selector";
import { AttachmentNotice, ImageAttachmentBar } from "./image-attachment-bar";
import { ImageModelPreferencePopover } from "./image-model-preference";
import { UploadRing } from "./upload-ring";

export type HomePromptHandle = {
  /** Programmatically set the textarea value (e.g. from an example pill). */
  fill: (text: string) => void;
};

type HomePromptProps = {
  onSubmit: (
    prompt: string,
    attachments?: ReadyAttachment[],
    imageGenerationPreference?: ImageGenerationPreference,
    model?: string,
  ) => void;
  disabled?: boolean | undefined;
  attachments?: ImageAttachmentState[] | undefined;
  onAddFiles?: ((files: File[]) => void) | undefined;
  onRemoveAttachment?: ((id: string) => void) | undefined;
  onRetryAttachment?: ((id: string) => void) | undefined;
  isUploading?: boolean | undefined;
  readyAttachments?: ReadyAttachment[] | undefined;
};

export const HomePrompt = forwardRef<HomePromptHandle, HomePromptProps>(
  function HomePrompt(
    {
      onSubmit,
      disabled,
      attachments,
      onAddFiles,
      onRemoveAttachment,
      onRetryAttachment,
      isUploading,
      readyAttachments,
    },
    ref,
  ) {
    const [value, setValue] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
    const prefBtnRef = useRef<HTMLButtonElement>(null);
    const { preference } = useImageModelPreference();
    const { model: agentModel } = useAgentModel();
    const { imageModels } = useAccount();

    const resize = useCallback(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 260)}px`;
    }, []);

    useImperativeHandle(ref, () => ({
      fill(text: string) {
        setValue(text);
        requestAnimationFrame(() => {
          resize();
          textareaRef.current?.focus();
        });
      },
    }));

    const hasAttachments = Boolean(attachments && attachments.length > 0);
    const hasContent = value.trim().length > 0 || hasAttachments;
    const failedUpload = attachments?.some((a) => a.error) ?? false;
    const canSubmit = hasContent && !disabled && !isUploading && !failedUpload;

    const handleSubmit = useCallback(() => {
      const trimmed = value.trim();
      if (!canSubmit) return;

      onSubmit(
        trimmed,
        readyAttachments?.length ? readyAttachments : undefined,
        resolveImagePreference(
          preference,
          imageModels.data ? imageModels.data.map((m) => m.id) : null,
        ),
        agentModel ?? undefined,
      );
      setValue("");
      requestAnimationFrame(resize);
    }, [value, canSubmit, readyAttachments, onSubmit, preference, imageModels.data, agentModel, resize]);

    // 交给助手 while pictures are still going up: it goes once they are
    // (through 0.0.17 the button was grey and Enter did nothing).
    const blocker = attachmentsBlocker(attachments);
    const waitingForPictures = blocker?.tone === "wait";
    const { queued, queue, cancel } = useSendWhenUploaded(attachments, handleSubmit);
    const [nudge, setNudge] = useState(0);
    const requestSubmit = useCallback(
      (fromKey: boolean) => {
        if (!hasContent || disabled) return;
        const reason = attachmentsBlocker(attachments);
        if (reason?.tone === "wait") {
          if (!queued) queue();
          else if (!fromKey) cancel();
          return;
        }
        if (reason) {
          console.info("[home-prompt] send held: a picture did not make it");
          setNudge((n) => n + 1);
          return;
        }
        handleSubmit();
      },
      [hasContent, disabled, attachments, queued, queue, cancel, handleSubmit],
    );
    const progress = attachmentsProgress(attachments);

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

    return (
      <div
        className="glass rounded-[24px] transition-shadow focus-within:shadow-[inset_0_1px_0_var(--glass-highlight),0_0_0_2px_var(--acc-soft),0_24px_48px_-28px_var(--shadow-2)]"
        onDragOver={(e) => {
          if (onAddFiles) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!onAddFiles) return;
          e.preventDefault();
          onAddFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {attachments && onRemoveAttachment && attachments.length > 0 ? (
          <div className="border-b border-line px-4">
            <ImageAttachmentBar
              attachments={attachments}
              onRemove={onRemoveAttachment}
              {...(onRetryAttachment ? { onRetry: onRetryAttachment } : {})}
            />
            <AttachmentNotice
              attachments={attachments}
              queued={queued}
              nudge={nudge}
              className="px-1 pb-2"
            />
          </div>
        ) : null}

        <label htmlFor="home-prompt" className="sr-only">
          给设计助手的需求
        </label>
        <textarea
          id="home-prompt"
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            resize();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              requestSubmit(true);
            }
          }}
          onPaste={handlePaste}
          placeholder="比如：给一家精品咖啡店做开业海报，三种方向，清爽的日系风格"
          disabled={disabled}
          rows={3}
          className="block w-full resize-none bg-transparent px-5 pt-5 pb-2 text-[16px] leading-[1.7] text-fg outline-none placeholder:text-fg-muted disabled:opacity-60"
        />

        <div className="flex items-center gap-1.5 px-3.5 pb-3.5">
          {onAddFiles ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={ATTACHMENT_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) onAddFiles(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="添加参考图"
                aria-label="添加参考图"
                className="sk flex h-9 w-10 items-center justify-center rounded-[10px] bg-tint/[0.055] text-fg-soft transition-colors hover:bg-tint/[0.1] hover:text-fg"
              >
                <ImagePlusIcon className="sk-in size-4" strokeWidth={1.9} />
              </button>
            </>
          ) : null}
          <AgentModelSelector />
          <button
            ref={prefBtnRef}
            type="button"
            onClick={() => setModelPopoverOpen((prev) => !prev)}
            title="生图模型偏好"
            aria-label="生图模型偏好"
            aria-expanded={modelPopoverOpen}
            className={cn(
              "sk flex h-9 items-center rounded-[10px] px-3 text-[13px] font-semibold transition-colors",
              preference.mode === "manual"
                ? "bg-fg text-ground"
                : "bg-tint/[0.055] text-fg-soft hover:bg-tint/[0.1] hover:text-fg",
            )}
          >
            <span className="sk-in gap-1.5">
              <SlidersHorizontalIcon className="size-3.5" strokeWidth={1.9} />
              <span className="hidden sm:inline">
                {preference.mode === "manual" ? `指定 ${preference.models.length} 个生图模型` : "生图模型自动"}
              </span>
            </span>
          </button>
          <ImageModelPreferencePopover
            open={modelPopoverOpen}
            onClose={() => setModelPopoverOpen(false)}
            anchorRef={prefBtnRef}
          />
          {waitingForPictures && hasContent && !disabled ? (
            // Pictures on their way: how far, and a press that waits for them.
            <button
              type="button"
              onClick={() => requestSubmit(false)}
              aria-label={queued ? "传完自动交给助手，点击取消" : "图片上传中，点击后传完自动交给助手"}
              aria-pressed={queued}
              title={queued ? "传完自动发送（再点一次取消）" : "图片上传中，现在点会在传完后自动发出"}
              className={cn(
                "sk ml-auto flex h-12 shrink-0 items-center rounded-[14px] px-4 font-display text-[17px] whitespace-nowrap sm:px-6 sm:text-[19px] transition-[background-color,box-shadow]",
                queued
                  ? "bg-acc text-acc-ink shadow-acc"
                  : "bg-acc-soft text-acc-text hover:bg-acc/[0.18]",
              )}
            >
              <span className="sk-in gap-2">
                <UploadRing
                  progress={progress.phase === "uploading" ? progress.fraction : null}
                  size={18}
                  stroke={2.5}
                />
                {queued
                  ? "传完自动发送"
                  : progress.phase === "preparing"
                    ? "压缩图片中"
                    : progress.percent !== null
                      ? `上传中 ${progress.percent}%`
                      : "上传中"}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => requestSubmit(false)}
              disabled={!canSubmit}
              aria-label="开始"
              title={failedUpload ? "有图片上传失败，重试或移除后再发送" : "发送（Enter）"}
              className="sk ml-auto flex h-12 shrink-0 items-center rounded-[14px] bg-acc px-4 font-display text-[17px] whitespace-nowrap text-acc-ink sm:px-6 sm:text-[19px] shadow-acc transition-[background-color,scale] hover:bg-acc-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-tint/[0.1] disabled:text-fg-muted disabled:shadow-none"
            >
              <span className="sk-in gap-1.5">
                交给助手
                <ArrowUpIcon className="size-[18px]" strokeWidth={2.4} />
              </span>
            </button>
          )}
        </div>
      </div>
    );
  },
);
