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
} from "../hooks/use-image-attachments";
import { useAgentModel } from "../hooks/use-agent-model";
import {
  resolveImagePreference,
  useImageModelPreference,
} from "../hooks/use-image-model-preference";
import { useAccount } from "../lib/account-context";
import { cn } from "../lib/utils";
import { AgentModelSelector } from "./agent-model-selector";
import { ImageAttachmentBar } from "./image-attachment-bar";
import { ImageModelPreferencePopover } from "./image-model-preference";

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
        className="glass rounded-[22px] transition-[border-color,box-shadow] focus-within:border-white/25 focus-within:shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_0_0_1px_rgb(var(--amb)/0.25),0_30px_80px_-40px_rgb(var(--amb)/0.6)]"
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
              handleSubmit();
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
                className="flex size-9 items-center justify-center rounded-full border border-line bg-white/[0.06] text-fg-soft transition-colors hover:border-line-strong hover:bg-white/[0.09] hover:text-fg"
              >
                <ImagePlusIcon className="size-4" strokeWidth={1.75} />
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
              "flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
              preference.mode === "manual"
                ? "border-transparent bg-fg text-ground"
                : "border-line bg-white/[0.06] text-fg-soft hover:border-line-strong hover:bg-white/[0.09] hover:text-fg",
            )}
          >
            <SlidersHorizontalIcon className="size-3.5" strokeWidth={1.75} />
            <span className="hidden sm:inline">
              {preference.mode === "manual" ? `指定 ${preference.models.length} 个生图模型` : "生图模型自动"}
            </span>
          </button>
          <ImageModelPreferencePopover
            open={modelPopoverOpen}
            onClose={() => setModelPopoverOpen(false)}
            anchorRef={prefBtnRef}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-label="开始"
            title={failedUpload ? "有图片上传失败，重试或移除后再发送" : "发送（Enter）"}
            className="ml-auto flex h-11 items-center gap-1.5 rounded-xl bg-fg px-5 text-[15px] font-semibold text-ground glow-amb transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-white/[0.12] disabled:text-fg-muted disabled:shadow-none"
          >
            交给助手
            <ArrowUpIcon className="size-4" strokeWidth={2} />
          </button>
        </div>
      </div>
    );
  },
);
