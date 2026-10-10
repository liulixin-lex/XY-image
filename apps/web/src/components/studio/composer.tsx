"use client";

import {
  ArrowRightIcon,
  MinusIcon,
  PlusIcon,
  RotateCwIcon,
  Undo2Icon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { IMAGE_BATCH_MAX, resolveImageParams } from "@loomic/shared";

import { ATTACHMENT_ACCEPT, useImageAttachments } from "@/hooks/use-image-attachments";
import {
  MAX_IN_FLIGHT,
  MAX_PENDING_JOBS,
  type StudioSubmitInput,
  type StudioSubmitResult,
} from "@/hooks/use-studio-jobs";
import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import {
  type ImageQuality,
  type ImageResolution,
  QUALITIES,
  QUALITY_HINT,
  QUALITY_LABEL,
  RESOLUTIONS,
  RESOLUTION_HINT,
  isAspectRatio,
  modelCapabilities,
  resolutionUnavailable,
} from "@/lib/image-model-meta";
import type { PendingDraft } from "@/lib/pending-prompt";
import { type ImageModelInfo, optimizePrompt } from "@/lib/server-api";
import { cn } from "@/lib/utils";

import { LiveDot } from "../ambient/live-dot";
import { useIssues } from "../issues/issue-provider";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Picker, Segmented } from "../ui/select";
import { RatioGrid } from "./ratio-grid";

/** Last-used 画质 / 质量 / 比例 / 数量 (v1 stored `quality: standard | hd` = 1K / 2K). */
const PARAMS_KEY = "xy:studio-params";
const PROMPT_MAX = 4000;
/** The rewrite route takes at most this much text (optimizePromptRequestSchema). */
const OPTIMIZE_MAX = 2000;

export type ComposerHandle = {
  /** Put a previous result's parameters back into the composer. */
  applyParams: (params: {
    prompt: string;
    model?: string | null;
    resolution?: ImageResolution;
    /** null for older records that had no 质量. */
    quality?: ImageQuality | null;
    aspectRatio?: string | null;
  }) => void;
  /** Use an existing image (a previous result) as a reference. */
  addReference: (ref: { url: string; assetId: string; name?: string }) => void;
  setPrompt: (prompt: string) => void;
  focus: () => void;
};

/**
 * The studio's settings panel (F2): model, description, references, 比例,
 * 画质 (1K / 2K / 4K), 质量 (自动 / 低 / 中 / 高), how many pictures, and the
 * one call to action. Options the chosen model lacks stay visible but
 * disabled; the panel shows (and sends) the closest supported value, the
 * same rule the server applies.
 *
 * One click sends one batch request; the page owns submission and never
 * retries it. 优化提示词 is a separate, small chat request on the user's
 * own model; the original text stays one click away (撤销).
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    models: ImageModelInfo[];
    /** A draft carried over from the landing page; applied once, unsent. */
    initialDraft?: PendingDraft | null;
    onSubmit: (input: StudioSubmitInput) => Promise<StudioSubmitResult | null>;
    submitting: boolean;
    /** Queued and generating pictures counted against MAX_PENDING_JOBS. */
    pendingCount: number;
    className?: string;
  }
>(function Composer({ models, initialDraft, onSubmit, submitting, pendingCount, className }, ref) {
  const { session } = useAuth();
  const { account, updatePreferences } = useAccount();
  const { report } = useIssues();
  const { error: toastError, toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string | null>(null);
  // What the user picked; the model may need a nearby value (effective*).
  const [resolution, setResolution] = useState<ImageResolution>("2K");
  const [quality, setQuality] = useState<ImageQuality>("auto");
  const [ratio, setRatio] = useState<string>("3:4");
  const [count, setCount] = useState(1);
  const [optimizing, setOptimizing] = useState(false);
  // The text before the last rewrite, for 撤销.
  const [beforeRewrite, setBeforeRewrite] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Settings continue below the visible part (short screens): fade the edge
  // so 画质 / 质量 do not look missing; the scrollbar itself is hidden.
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const observer = new ResizeObserver(check);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", check);
      observer.disconnect();
    };
  }, []);

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

  // Restore 画质 / 质量 / 比例 / 数量 from the last session. Saving waits for
  // this: the first render still holds the defaults, and writing them would
  // overwrite what is about to be restored (seen under StrictMode's
  // double-run, where the second restore then read the defaults back).
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PARAMS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        resolution?: unknown;
        quality?: unknown;
        ratio?: unknown;
        count?: number;
      };
      if (RESOLUTIONS.includes(saved.resolution as ImageResolution))
        setResolution(saved.resolution as ImageResolution);
      else if (saved.quality === "standard" || saved.quality === "hd")
        setResolution(saved.quality === "hd" ? "2K" : "1K");
      if (QUALITIES.includes(saved.quality as ImageQuality)) setQuality(saved.quality as ImageQuality);
      if (isAspectRatio(saved.ratio)) setRatio(saved.ratio);
      if (Number.isInteger(saved.count) && saved.count! >= 1 && saved.count! <= IMAGE_BATCH_MAX)
        setCount(saved.count!);
    } catch {
      // ignore malformed storage
    } finally {
      setRestored(true);
    }
  }, []);

  // A landing-page draft wins over the saved params (declared after the
  // restore effect so it runs after it).
  useEffect(() => {
    if (!initialDraft) return;
    setPrompt(initialDraft.prompt);
    if (initialDraft.resolution) setResolution(initialDraft.resolution);
    if (initialDraft.aspectRatio) setRatio(initialDraft.aspectRatio);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [initialDraft]);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(PARAMS_KEY, JSON.stringify({ resolution, quality, ratio, count }));
    } catch {
      // ignore
    }
  }, [restored, resolution, quality, ratio, count]);

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
      return models[0]?.id ?? null;
    });
  }, [models, preferredModel]);

  const current = models.find((m) => m.id === model) ?? null;
  const caps = modelCapabilities(current);
  // What will actually be sent: the server applies the same shared rules.
  const {
    resolution: sendResolution,
    quality: sendQuality,
    aspectRatio: sendRatio,
  } = resolveImageParams(caps, { resolution, quality, aspectRatio: ratio });
  const topQuality = caps.qualities.at(-1);
  const refLimit = caps.maxInputImages;
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
        setBeforeRewrite(null);
        if (params.model && models.some((m) => m.id === params.model)) setModel(params.model);
        if (params.resolution) setResolution(params.resolution);
        if (params.quality) setQuality(params.quality);
        if (isAspectRatio(params.aspectRatio)) setRatio(params.aspectRatio);
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
      setPrompt: (value) => {
        setPrompt(value);
        setBeforeRewrite(null);
      },
      focus: () => textareaRef.current?.focus({ preventScroll: true }),
    }),
    [addCanvasRef, models],
  );

  // Auto-size the prompt.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [prompt]);

  const trimmed = prompt.trim();
  const room = Math.max(0, MAX_PENDING_JOBS - pendingCount);
  const blockedReason = !current
    ? "当前 Key 没有可用的生图模型"
    : room === 0
      ? `排队和生成中的已有 ${MAX_PENDING_JOBS} 张，等前面的完成`
      : count > room
        ? `现在最多还能排 ${room} 张，把数量调到 ${room} 或等前面的完成`
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
    const result = await onSubmit({
      prompt: trimmed,
      model,
      resolution: sendResolution,
      quality: sendQuality,
      aspect_ratio: sendRatio,
      count,
      ...(readyAttachments.length ? { input_images: readyAttachments.map((a) => a.url) } : {}),
    });
    if (!result) {
      textareaRef.current?.focus();
      return;
    }
    // Keep the prompt: iterating on wording is the common next step.
    setBeforeRewrite(null);
    if (result.queued < result.requested)
      toast(
        `排上了 ${result.queued} 张，另外 ${result.requested - result.queued} 张没有发出，不收费。`,
      );
  };

  const rewrite = async () => {
    const token = session?.access_token;
    if (!token || !trimmed || optimizing) return;
    setOptimizing(true);
    try {
      const result = await optimizePrompt(token, {
        prompt: trimmed.slice(0, OPTIMIZE_MAX),
        aspect_ratio: sendRatio,
      });
      setBeforeRewrite(prompt);
      setPrompt(result.prompt.slice(0, PROMPT_MAX));
      console.info("[studio] prompt rewritten", { model: result.model, from: trimmed.length, to: result.prompt.length });
      requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    } catch (error) {
      report(error);
    } finally {
      setOptimizing(false);
    }
  };

  const undoRewrite = () => {
    if (beforeRewrite === null) return;
    setPrompt(beforeRewrite);
    setBeforeRewrite(null);
    textareaRef.current?.focus({ preventScroll: true });
  };

  const modelOptions = useMemo(
    () =>
      models.map((m) => ({
        value: m.id,
        text: m.displayName,
        label: m.displayName,
        description: `${m.description} · 最高 ${modelCapabilities(m).resolutions.at(-1) ?? "1K"}`,
      })),
    [models],
  );

  return (
    <section
      aria-label="生成设置"
      className={cn("glass flex flex-col rounded-[24px]", className)}
      onDragOver={(e) => {
        if (refLimit > 0) e.preventDefault();
      }}
      onDrop={(e) => {
        if (refLimit === 0) return;
        e.preventDefault();
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div
        ref={scrollRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pt-5 pb-4 scrollbar-hidden sm:px-6",
          moreBelow && "[mask-image:linear-gradient(to_bottom,#000_calc(100%-56px),transparent)]",
        )}
      >
        <Field label="模型" inline>
          <Picker
            ariaLabel="模型"
            value={model}
            onValueChange={chooseModel}
            options={modelOptions}
            placeholder="没有可用模型"
            disabled={models.length === 0}
            className="h-11 w-full rounded-[12px] bg-panel/75 text-[14px]"
            popupClassName="w-[300px]"
          />
        </Field>

        <Field label="提示词" htmlFor="studio-prompt">
          <div className="rounded-[14px] bg-panel/75 px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--acc),0_0_0_3px_var(--acc-soft)]">
            <textarea
              id="studio-prompt"
              ref={textareaRef}
              value={prompt}
              maxLength={PROMPT_MAX}
              rows={4}
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
              placeholder="写下你想要的画面：主体、场景、光线、风格。"
              className="block min-h-[104px] w-full resize-none bg-transparent text-[15.5px] leading-[1.7] text-fg caret-acc placeholder:text-fg-muted focus:outline-none"
            />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            {beforeRewrite !== null && !optimizing ? (
              <button
                type="button"
                onClick={undoRewrite}
                className="sk inline-flex h-8 items-center rounded-[9px] bg-tint/[0.06] px-3 text-[13px] font-semibold text-fg transition-colors hover:bg-tint/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
              >
                <span className="sk-in gap-1.5">
                  <Undo2Icon className="size-3.5" strokeWidth={2} />
                  撤销改写
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void rewrite()}
                disabled={!trimmed || optimizing || trimmed.length > OPTIMIZE_MAX}
                title={trimmed.length > OPTIMIZE_MAX ? `超过 ${OPTIMIZE_MAX} 字的描述不再改写` : undefined}
                className="sk inline-flex h-8 items-center rounded-[9px] bg-acc-soft px-3 text-[13px] font-semibold text-acc-text transition-[background-color,opacity] hover:bg-acc/[0.18] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="sk-in gap-1.5">
                  {optimizing ? <LiveDot /> : <WandSparklesIcon className="size-3.5" strokeWidth={2} />}
                  {optimizing ? "正在改写" : "优化提示词"}
                </span>
              </button>
            )}
            <span className="text-[12.5px] text-fg-muted">
              {beforeRewrite !== null && !optimizing ? "已按你的意思写具体" : "用你的对话模型，会用到少量余额"}
            </span>
            {prompt.length > PROMPT_MAX - 200 ? (
              <span className="ml-auto text-[12px] text-fg-muted tabular">
                {prompt.length}/{PROMPT_MAX}
              </span>
            ) : null}
          </div>
        </Field>

        <Field
          label="参考图"
          note={refLimit === 0 ? "当前模型不支持" : `最多 ${refLimit} 张`}
          noteTone={overRefLimit ? "alert" : "muted"}
        >
          <div className="flex flex-wrap gap-2.5">
            {attachments.map((att) => (
              <div key={att.id} className="relative size-[60px] shrink-0">
                {/* biome-ignore lint/performance/noImgElement: blob/signed preview */}
                <img
                  src={att.preview}
                  alt={att.name ?? "参考图"}
                  className={cn(
                    "size-full rounded-[12px] object-cover shadow-[0_6px_14px_-8px_var(--shadow-2)]",
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
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-fg text-ground shadow-subtle transition-transform hover:scale-110"
                >
                  <XIcon className="size-3" strokeWidth={2.6} />
                </button>
              </div>
            ))}
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
            {refLimit > 0 && refCount < refLimit ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label={`添加参考图（最多 ${refLimit} 张）`}
                title="点击选择，也可以粘贴或拖进来"
                className="flex size-[60px] shrink-0 items-center justify-center rounded-[12px] border border-dashed border-line-strong text-fg-muted transition-colors hover:border-acc hover:bg-acc-soft hover:text-acc-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
              >
                <PlusIcon className="size-5" strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        </Field>

        <Field label="比例" note={sendRatio !== ratio ? `当前模型用 ${sendRatio}` : undefined}>
          <RatioGrid value={sendRatio} onValueChange={setRatio} supported={caps.aspectRatios} />
        </Field>

        <Field
          label="画质"
          note={
            // Raised because the shape needs it (e.g. OpenAI 16:9 starts at 2K).
            sendResolution !== resolution && caps.resolutions.includes(resolution)
              ? `${sendRatio} 最小 ${sendResolution}，按 ${sendResolution} 出图`
              : RESOLUTION_HINT[sendResolution]
          }
        >
          <Segmented
            ariaLabel="画质"
            size="lg"
            value={sendResolution}
            onValueChange={(v) => setResolution(v as ImageResolution)}
            options={RESOLUTIONS.map((value) => {
              const reason = resolutionUnavailable(caps, value, sendRatio);
              return { value, label: value, disabled: reason !== null, ...(reason ? { title: reason } : {}) };
            })}
            className="flex w-full"
          />
        </Field>

        <Field
          label="质量"
          note={caps.qualities.length ? QUALITY_HINT[sendQuality] : "当前模型不可调，由模型决定"}
        >
          <Segmented
            ariaLabel="质量"
            value={sendQuality}
            onValueChange={(v) => setQuality(v as ImageQuality)}
            options={QUALITIES.map((value) => {
              const enabled = value === "auto" || caps.qualities.includes(value);
              return {
                value,
                label: QUALITY_LABEL[value],
                disabled: !enabled,
                ...(enabled
                  ? {}
                  : {
                      title: topQuality
                        ? `当前模型最高 ${QUALITY_LABEL[topQuality]}`
                        : "当前模型不可调",
                    }),
              };
            })}
            className="flex w-full"
          />
        </Field>
      </div>

      <div className="shrink-0 px-5 pt-2 pb-5 sm:px-6">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5">
          <Stepper value={count} min={1} max={IMAGE_BATCH_MAX} onChange={setCount} />
          <Button
            variant="accent"
            size="poster"
            slant
            className="h-14 w-full text-[21px]"
            disabled={!canSubmit}
            onClick={() => void submit()}
            title={blockedReason ?? undefined}
          >
          {submitting ? (
            <>
              <LiveDot className="bg-acc-ink" />
              正在提交
            </>
          ) : (
            <>
              生成<span className="numeral text-[26px]">{count}</span>张
              <ArrowRightIcon strokeWidth={2.4} />
            </>
          )}
          </Button>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-fg-muted" aria-live="polite">
          {blockedReason && trimmed ? (
            <span className="text-fg-soft">{blockedReason}</span>
          ) : count > MAX_IN_FLIGHT ? (
            `每张单独计费。同时最多发出 ${MAX_IN_FLIGHT} 张，其余排队，还没发出的可以取消。`
          ) : (
            "按次从主站余额支付。每次请求只发一次，失败不会自动重发。"
          )}
        </p>
      </div>
    </section>
  );
});

function Field({
  label,
  htmlFor,
  note,
  noteTone = "muted",
  inline = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  note?: string | undefined;
  noteTone?: "muted" | "alert";
  /** Label and control on one row (short controls such as the model picker). */
  inline?: boolean;
  children: React.ReactNode;
}) {
  const Label = htmlFor ? "label" : "p";
  if (inline)
    return (
      <div className="flex items-center gap-3">
        <Label {...(htmlFor ? { htmlFor } : {})} className="poster-label shrink-0 text-[17px] leading-none text-fg">
          {label}
        </Label>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <Label {...(htmlFor ? { htmlFor } : {})} className="poster-label text-[17px] leading-none text-fg">
          {label}
        </Label>
        {note ? (
          <span className={cn("text-[12.5px]", noteTone === "alert" ? "text-alert" : "text-fg-muted")}>
            {note}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** − n + for the number of pictures (each one a separate charge), beside 生成. */
function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const button =
    "flex size-8 shrink-0 items-center justify-center rounded-full bg-tint/[0.07] text-fg transition-[background-color,scale] hover:bg-tint/[0.12] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:cursor-not-allowed disabled:opacity-35";
  return (
    <div
      role="group"
      aria-label="生成张数"
      className="flex h-14 w-[118px] items-center justify-between rounded-[14px] bg-panel/75 px-2 shadow-[inset_0_0_0_1px_var(--line)]"
    >
      <button
        type="button"
        className={button}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="少一张"
      >
        <MinusIcon className="size-4" strokeWidth={2.4} />
      </button>
      <output aria-live="polite" aria-label={`${value} 张`} className="numeral text-[28px] text-fg">
        {value}
      </output>
      <button
        type="button"
        className={button}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="多一张"
      >
        <PlusIcon className="size-4" strokeWidth={2.4} />
      </button>
    </div>
  );
}
