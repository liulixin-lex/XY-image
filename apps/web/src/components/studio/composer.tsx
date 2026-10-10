"use client";

import { ArrowRightIcon, ImagePlusIcon, RotateCwIcon, XIcon } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import {
  ASPECT_RATIOS,
  type AspectRatio,
  QUALITY_LABEL,
  maxReferenceImages,
} from "@/lib/image-model-meta";
import type { PendingDraft } from "@/lib/pending-prompt";
import type { CreateImageJobInput, ImageModelInfo, ImageQuality } from "@/lib/server-api";
import { cn } from "@/lib/utils";
import { ATTACHMENT_ACCEPT, useImageAttachments } from "@/hooks/use-image-attachments";

import { LiveDot } from "../ambient/live-dot";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Picker } from "../ui/select";

const PARAMS_KEY = "xy:studio-params";
const PROMPT_MAX = 4000;

export type ComposerHandle = {
  /** Put a previous result's parameters back into the composer. */
  applyParams: (params: {
    prompt: string;
    model?: string | null;
    quality?: ImageQuality;
    aspectRatio?: string | null;
  }) => void;
  /** Use an existing image (a previous result) as a reference. */
  addReference: (ref: { url: string; assetId: string; name?: string }) => void;
  setPrompt: (prompt: string) => void;
  focus: () => void;
};

function RatioGlyph({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(":").map(Number) as [number, number];
  const scale = 11 / Math.max(w, h);
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-[2px] border-[1.5px] border-current text-fg-muted"
      style={{ width: Math.round(w * scale) + 2, height: Math.round(h * scale) + 2 }}
    />
  );
}

/**
 * The studio's prompt composer. One click creates at most one job; the
 * page owns submission (and never retries it).
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    models: ImageModelInfo[];
    /** A draft carried over from the landing page; applied once, unsent. */
    initialDraft?: PendingDraft | null;
    onSubmit: (input: CreateImageJobInput) => Promise<boolean>;
    submitting: boolean;
    activeCount: number;
    maxActive: number;
    className?: string;
  }
>(function Composer(
  { models, initialDraft, onSubmit, submitting, activeCount, maxActive, className },
  ref,
) {
  const { session } = useAuth();
  const { account, updatePreferences } = useAccount();
  const { error: toastError } = useToast();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [quality, setQuality] = useState<ImageQuality>("hd");
  const [ratio, setRatio] = useState<AspectRatio>("1:1");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const {
    attachments,
    addFiles,
    addCanvasRef,
    removeAttachment,
    retryUpload,
    isUploading,
    readyAttachments,
  } = useImageAttachments(session?.access_token ?? "", undefined, {
    onReject: (message) => toastError(message),
  });

  // Restore quality/ratio from the last session.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PARAMS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { quality?: string; ratio?: string };
      if (saved.quality === "standard" || saved.quality === "hd") setQuality(saved.quality);
      if (ASPECT_RATIOS.includes(saved.ratio as AspectRatio)) setRatio(saved.ratio as AspectRatio);
    } catch {
      // ignore malformed storage
    }
  }, []);

  // A landing-page draft wins over the saved params (declared after the
  // restore effect so it runs after it).
  useEffect(() => {
    if (!initialDraft) return;
    setPrompt(initialDraft.prompt);
    if (initialDraft.quality) setQuality(initialDraft.quality);
    if (ASPECT_RATIOS.includes(initialDraft.aspectRatio as AspectRatio))
      setRatio(initialDraft.aspectRatio as AspectRatio);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [initialDraft]);

  useEffect(() => {
    try {
      localStorage.setItem(PARAMS_KEY, JSON.stringify({ quality, ratio }));
    } catch {
      // ignore
    }
  }, [quality, ratio]);

  // Model: keep the current choice while valid; otherwise the saved
  // preference, otherwise the first model the key offers.
  const preferredModel = account.data?.preferences.default_image_model ?? null;
  useEffect(() => {
    if (models.length === 0) {
      setModel(null);
      return;
    }
    setModel((current) => {
      if (current && models.some((m) => m.id === current)) return current;
      if (preferredModel && models.some((m) => m.id === preferredModel)) return preferredModel;
      return models[0]!.id;
    });
  }, [models, preferredModel]);

  const current = models.find((m) => m.id === model) ?? null;
  const supportsHd = current?.maxQuality !== "standard";
  const effectiveQuality: ImageQuality = supportsHd ? quality : "standard";
  const refLimit = maxReferenceImages(model);
  const refCount = attachments.length;
  const overRefLimit = refCount > refLimit;

  const chooseModel = useCallback(
    (next: string) => {
      setModel(next);
      // Remember as the account default (best effort, server validates).
      updatePreferences({ defaultImageModel: next }).catch((error) =>
        console.warn("[studio] could not save default model", error),
      );
    },
    [updatePreferences],
  );

  useImperativeHandle(
    ref,
    () => ({
      applyParams: (params) => {
        setPrompt(params.prompt);
        if (params.model && models.some((m) => m.id === params.model)) setModel(params.model);
        if (params.quality) setQuality(params.quality);
        if (ASPECT_RATIOS.includes(params.aspectRatio as AspectRatio))
          setRatio(params.aspectRatio as AspectRatio);
        requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
      },
      addReference: (refImage) => {
        addCanvasRef({
          assetId: refImage.assetId,
          url: refImage.url,
          mimeType: "image/png",
          ...(refImage.name ? { name: refImage.name } : {}),
        });
      },
      setPrompt: (value) => setPrompt(value),
      focus: () => textareaRef.current?.focus({ preventScroll: true }),
    }),
    [addCanvasRef, models],
  );

  // Auto-size the prompt.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [prompt]);

  const atCapacity = activeCount >= maxActive;
  const trimmed = prompt.trim();
  const blockedReason = !current
    ? "当前 Key 没有可用的生图模型"
    : atCapacity
      ? `同时最多生成 ${maxActive} 张，等前面的完成`
      : isUploading
        ? "参考图还在上传"
        : overRefLimit
          ? `${current.displayName} 最多 ${refLimit} 张参考图`
          : attachments.some((a) => a.error)
            ? "有参考图上传失败，重试或移除后再提交"
            : null;
  const canSubmit = Boolean(trimmed) && !blockedReason && !submitting;

  const submit = async () => {
    if (!canSubmit || !model) return;
    const ok = await onSubmit({
      prompt: trimmed,
      model,
      quality: effectiveQuality,
      aspect_ratio: ratio,
      ...(readyAttachments.length
        ? { input_images: readyAttachments.map((a) => a.url) }
        : {}),
    });
    // Keep the prompt: iterating on wording is the common next step.
    if (!ok) textareaRef.current?.focus();
  };

  const modelOptions = useMemo(
    () =>
      models.map((m) => ({
        value: m.id,
        text: m.displayName,
        label: m.displayName,
        description: `${m.description} · 最高 ${QUALITY_LABEL[m.maxQuality ?? "hd"]}`,
      })),
    [models],
  );

  const qualityOptions = useMemo(
    () => [
      { value: "standard", text: "1K 标准", label: "1K 标准" },
      {
        value: "hd",
        text: "2K 高清",
        label: "2K 高清",
        disabled: !supportsHd,
        ...(supportsHd ? {} : { description: "当前模型最高 1K" }),
      },
    ],
    [supportsHd],
  );

  return (
    <div className={className}>
      <section
        aria-label="生成设置"
        className="glass rounded-[22px] pt-4 pr-3.5 pb-3.5 pl-4 transition-[border-color,box-shadow] focus-within:border-tint/25 focus-within:shadow-[inset_0_1px_0_var(--glass-highlight),0_0_0_1px_rgb(var(--amb)/0.25),0_30px_80px_-40px_rgb(var(--amb)/0.6)]"
        onDragOver={(e) => {
          if (refLimit > 0) e.preventDefault();
        }}
        onDrop={(e) => {
          if (refLimit === 0) return;
          e.preventDefault();
          addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {attachments.length > 0 ? (
          <div className="mb-2 flex items-center gap-2.5 overflow-x-auto pt-1.5 pr-1.5 pb-1 scrollbar-hidden">
            {attachments.map((att) => (
              <div key={att.id} className="relative size-16 shrink-0">
                {/* biome-ignore lint/performance/noImgElement: blob/signed preview */}
                <img
                  src={att.preview}
                  alt={att.name ?? "参考图"}
                  className={cn(
                    "size-full rounded-[12px] object-cover shadow-[0_0_0_1px_rgb(255_255_255/0.25)]",
                    (att.uploading || att.error) && "opacity-50",
                  )}
                />
                {att.uploading ? (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <LiveDot />
                  </span>
                ) : null}
                {att.error ? (
                  <button
                    type="button"
                    onClick={() => retryUpload(att.id)}
                    title={att.error}
                    aria-label="重试上传"
                    className="absolute inset-0 flex items-center justify-center rounded-[12px] bg-alert-wash text-alert"
                  >
                    <RotateCwIcon className="size-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  aria-label="移除参考图"
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-ground-deep/85 text-fg shadow-[0_0_0_1px_rgb(255_255_255/0.2)] transition-colors hover:bg-ground-deep"
                >
                  <XIcon className="size-3" strokeWidth={2.4} />
                </button>
              </div>
            ))}
            <span className={cn("ml-1 shrink-0 text-[12px] tabular", overRefLimit ? "text-alert" : "text-fg-muted")}>
              参考图 {refCount}/{refLimit}
            </span>
          </div>
        ) : null}

        <label htmlFor="studio-prompt" className="sr-only">
          描述你想要的画面
        </label>
        <textarea
          id="studio-prompt"
          ref={textareaRef}
          value={prompt}
          maxLength={PROMPT_MAX}
          rows={3}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          onPaste={(e) => {
            if (refLimit === 0) return;
            const files = Array.from(e.clipboardData.items)
              .filter((item) => item.type.startsWith("image/"))
              .map((item) => item.getAsFile())
              .filter((f): f is File => f !== null);
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          placeholder="描述你想要的画面：主体、场景、光线、风格。可以粘贴或拖入参考图。"
          className="block min-h-[92px] w-full resize-none bg-transparent pr-1 text-[16px] leading-[1.7] text-fg caret-acc placeholder:text-fg-muted focus:outline-none sm:text-[16.5px]"
        />

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={refLimit === 0 || refCount >= refLimit}
            title={refLimit === 0 ? "当前模型不支持参考图" : `添加参考图（最多 ${refLimit} 张）`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-tint/[0.06] px-3 text-[13px] font-medium text-fg transition-colors outline-none hover:border-line-strong hover:bg-tint/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:cursor-not-allowed disabled:text-fg-muted"
          >
            <ImagePlusIcon className="size-4 text-fg-soft" strokeWidth={1.75} />
            参考图
          </button>

          <Picker
            ariaLabel="模型"
            value={model}
            onValueChange={chooseModel}
            options={modelOptions}
            placeholder="没有可用模型"
            disabled={models.length === 0}
            className="w-auto max-w-[200px]"
            popupClassName="w-[300px]"
          />
          <Picker
            ariaLabel="画面比例"
            value={ratio}
            onValueChange={(v) => setRatio(v as AspectRatio)}
            icon={<RatioGlyph ratio={ratio} />}
            options={ASPECT_RATIOS.map((r) => ({
              value: r,
              text: r,
              label: (
                <span className="inline-flex items-center gap-2">
                  <RatioGlyph ratio={r} />
                  {r}
                </span>
              ),
            }))}
            className="w-auto"
            popupClassName="w-[140px]"
          />
          <Picker
            ariaLabel="画质"
            value={effectiveQuality}
            onValueChange={(v) => setQuality(v as ImageQuality)}
            options={qualityOptions}
            className="w-auto"
            popupClassName="w-[180px]"
          />

          <Button
            variant="accent"
            size="lg"
            className="ml-auto h-11 rounded-xl px-5"
            disabled={!canSubmit}
            onClick={() => void submit()}
            title={blockedReason ?? undefined}
          >
            {submitting ? <LiveDot className="bg-ground" /> : null}
            {submitting ? "正在提交" : "开始生成"}
            {submitting ? null : <ArrowRightIcon strokeWidth={2} />}
          </Button>
        </div>
      </section>
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[12.5px] text-fg-muted" aria-live="polite">
        {blockedReason && trimmed ? (
          <span className="text-fg-soft">{blockedReason}</span>
        ) : (
          <span>按次从主站余额扣费，发出后不会自动重试</span>
        )}
        <span className="hidden sm:inline">⌘/Ctrl + Enter 直接生成</span>
        {prompt.length > PROMPT_MAX - 200 ? (
          <span className="tabular">
            {prompt.length}/{PROMPT_MAX}
          </span>
        ) : null}
      </p>
    </div>
  );
});
