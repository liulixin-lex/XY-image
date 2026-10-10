"use client";

import {
  type ImageEdit,
  IMAGE_BATCH_MAX,
  OUTPAINT_ANCHORS,
  type OutpaintAnchor,
  aspectRatioValue,
  outpaintFrame,
  resolveImageParams,
} from "@loomic/shared";
import {
  ArrowRightIcon,
  BrushIcon,
  EraserIcon,
  Redo2Icon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LiveDot } from "@/components/ambient/live-dot";
import { useIssues } from "@/components/issues/issue-provider";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PosterTabs, posterPanelProps } from "@/components/ui/poster-tabs";
import { Picker, Segmented } from "@/components/ui/select";
import {
  MAX_PENDING_JOBS,
  type StudioSubmitInput,
  type StudioSubmitResult,
} from "@/hooks/use-studio-jobs";
import { useAuth } from "@/lib/auth-context";
import type { ImageJobView } from "@/lib/image-jobs";
import {
  RESOLUTIONS,
  RESOLUTION_HINT,
  modelCapabilities,
  resolutionUnavailable,
} from "@/lib/image-model-meta";
import {
  ANCHOR_LABEL,
  BRUSH_DEFAULT,
  BRUSH_MAX,
  BRUSH_MIN,
  DEFAULT_OUTPAINT_PROMPT,
  IMAGE_EDIT_LABEL,
  type ImageEditMode,
  type MaskStroke,
  OUTPAINT_SCALES,
  OUTPAINT_SCALE_LABEL,
  sourceRatio,
} from "@/lib/mask-edit";
import { type ImageModelInfo, uploadFile } from "@/lib/server-api";
import { cn } from "@/lib/utils";

import { Field, Stepper } from "./composer";
import { MaskPainter, type MaskPainterHandle } from "./mask-painter";
import { RatioGrid } from "./ratio-grid";
import { useFitBox } from "./use-fit-box";

const PROMPT_MAX = 4000;
const MODES: ImageEditMode[] = ["inpaint", "outpaint"];

export type EditTarget = { job: ImageJobView; mode: ImageEditMode };

/**
 * 局部重绘 / 扩图 of one finished picture. Each picture asked for is its own
 * request to the main site, like the composer; nothing is sent until the
 * button is pressed, and nothing is re-sent.
 */
export function EditDialog({
  target,
  models,
  pendingCount,
  submitting,
  onSubmit,
  onClose,
}: {
  target: EditTarget | null;
  models: ImageModelInfo[];
  pendingCount: number;
  submitting: boolean;
  onSubmit: (input: StudioSubmitInput) => Promise<StudioSubmitResult | null>;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-[min(880px,94dvh)] max-h-[94dvh] gap-0 overflow-hidden p-0 sm:max-w-[min(1240px,96vw)]">
        {target?.job.url ? (
          <EditBody
            key={target.job.id}
            job={target.job}
            source={target.job.url}
            initialMode={target.mode}
            models={models}
            pendingCount={pendingCount}
            submitting={submitting}
            onSubmit={onSubmit}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditBody({
  job,
  source,
  initialMode,
  models,
  pendingCount,
  submitting,
  onSubmit,
  onClose,
}: {
  job: ImageJobView;
  source: string;
  initialMode: ImageEditMode;
  models: ImageModelInfo[];
  pendingCount: number;
  submitting: boolean;
  onSubmit: (input: StudioSubmitInput) => Promise<StudioSubmitResult | null>;
  onClose: () => void;
}) {
  const { session } = useAuth();
  const { report } = useIssues();
  const { toast } = useToast();
  const painter = useRef<MaskPainterHandle>(null);

  const capable = useMemo(() => models.filter((m) => m.maskEdit), [models]);
  const [mode, setMode] = useState<ImageEditMode>(initialMode);
  const [model, setModel] = useState<string | null>(
    () => capable.find((m) => m.id === job.model)?.id ?? capable[0]?.id ?? null,
  );
  const current = capable.find((m) => m.id === model) ?? null;
  const caps = modelCapabilities(current);

  // The picture's own size: from the job, else read from the image.
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(
    job.width && job.height ? { width: job.width, height: job.height } : null,
  );
  useEffect(() => {
    if (natural) return;
    const image = new Image();
    image.onload = () => setNatural({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = source;
  }, [natural, source]);

  // 局部重绘
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [redo, setRedo] = useState<MaskStroke[]>([]);
  const [brush, setBrush] = useState(BRUSH_DEFAULT);
  const [erase, setErase] = useState(false);
  const painted = strokes.some((stroke) => !stroke.erase);
  const addStroke = useCallback((stroke: MaskStroke) => {
    setStrokes((prev) => [...prev, stroke]);
    setRedo([]);
  }, []);
  const undo = useCallback(() => {
    setStrokes((prev) => {
      const last = prev.at(-1);
      if (last) setRedo((r) => [...r, last]);
      return prev.slice(0, -1);
    });
  }, []);
  const redoStroke = useCallback(() => {
    setRedo((prev) => {
      const last = prev.at(-1);
      if (last) setStrokes((s) => [...s, last]);
      return prev.slice(0, -1);
    });
  }, []);

  // 扩图
  const ownRatio = sourceRatio(job, caps.aspectRatios) ?? caps.aspectRatios[0] ?? "1:1";
  const [outRatio, setOutRatio] = useState<string>(ownRatio);
  const [scale, setScale] = useState<(typeof OUTPAINT_SCALES)[number]>(1.5);
  const [anchor, setAnchor] = useState<OutpaintAnchor>("center");

  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState(job.resolution);
  const [count, setCount] = useState(1);
  const [uploading, setUploading] = useState(false);

  const ask = resolveImageParams(caps, {
    resolution,
    quality: job.quality ?? "auto",
    aspectRatio: mode === "inpaint" ? ownRatio : outRatio,
  });
  const frame =
    natural && mode === "outpaint"
      ? outpaintFrame(natural, aspectRatioValue(ask.aspectRatio) ?? 1, scale, anchor)
      : null;

  const trimmed = prompt.trim();
  const room = Math.max(0, MAX_PENDING_JOBS - pendingCount);
  const blockedReason = !current
    ? "当前 Key 的模型都不支持局部重绘和扩图"
    : room === 0
      ? `排队和生成中的已有 ${MAX_PENDING_JOBS} 张，等前面的完成`
      : count > room
        ? `现在最多还能排 ${room} 张`
        : !natural
          ? "正在读取原图"
          : mode === "inpaint" && !painted
            ? "先在图上涂出要修改的地方"
            : mode === "inpaint" && !trimmed
              ? "写下涂抹的地方要改成什么"
              : mode === "outpaint" && !frame
                ? "换一个比例或放大一些，现在不会多出画面"
                : null;
  const busy = submitting || uploading;
  const canSubmit = !blockedReason && !busy;

  const submit = async () => {
    const token = session?.access_token;
    if (!canSubmit || !current || !token) return;
    let edit: ImageEdit;
    if (mode === "inpaint") {
      const mask = await painter.current?.exportMask();
      if (!mask) {
        toast("涂抹的地方太小了，再多涂一些");
        return;
      }
      setUploading(true);
      try {
        const uploaded = await uploadFile(
          token,
          new File([mask.blob], "mask.png", { type: "image/png" }),
        );
        edit = { mode: "inpaint", mask: uploaded.url };
        console.info("[studio] mask uploaded", { share: Number(mask.share.toFixed(3)) });
      } catch (error) {
        report(error);
        return;
      } finally {
        setUploading(false);
      }
    } else {
      edit = { mode: "outpaint", scale, anchor };
    }
    const result = await onSubmit({
      prompt: (trimmed || DEFAULT_OUTPAINT_PROMPT).slice(0, PROMPT_MAX),
      model: current.id,
      resolution: ask.resolution,
      quality: ask.quality,
      aspect_ratio: ask.aspectRatio,
      count,
      input_images: [source],
      edit,
    });
    if (!result) return;
    console.info("[studio] edit queued", { mode, queued: result.queued });
    if (result.queued < result.requested)
      toast(`排上了 ${result.queued} 张，另外 ${result.requested - result.queued} 张没有发出。`);
    onClose();
  };

  const modelOptions = useMemo(
    () =>
      capable.map((m) => ({
        value: m.id,
        text: m.displayName,
        label: m.displayName,
        description: m.description,
      })),
    [capable],
  );

  return (
    <div
      // Opaque, unlike other dialogs: the feed behind must not show through
      // the picture being painted on.
      className="grid h-full min-h-0 grid-rows-[minmax(240px,46dvh)_minmax(0,1fr)] bg-panel md:grid-cols-[minmax(0,1fr)_368px] md:grid-rows-1"
      onKeyDown={(event) => {
        if (mode !== "inpaint") return;
        const target = event.target as HTMLElement;
        if (target.closest("textarea, input, [role='listbox']")) return;
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) redoStroke();
          else undo();
        } else if (mod && event.key.toLowerCase() === "y") {
          event.preventDefault();
          redoStroke();
        } else if (event.key === "[") setBrush((b) => Math.max(BRUSH_MIN, b - 8));
        else if (event.key === "]") setBrush((b) => Math.min(BRUSH_MAX, b + 8));
      }}
    >
      <div className="relative flex min-h-0 flex-col bg-ground-deep/60">
        <div className="min-h-0 flex-1 p-4 md:p-8">
          {natural ? (
            mode === "inpaint" ? (
              <MaskPainter
                ref={painter}
                src={source}
                width={natural.width}
                height={natural.height}
                brush={brush}
                erase={erase}
                strokes={strokes}
                onStroke={addStroke}
              />
            ) : (
              <OutpaintPreview src={source} frame={frame} ratio={ask.aspectRatio} />
            )
          ) : (
            <div className="h-full w-full animate-breathe rounded-[12px]" aria-label="正在读取原图" />
          )}
        </div>
        {mode === "inpaint" ? (
          <div className="flex shrink-0 justify-center px-3 pb-3 md:pb-5">
            {/* Phones: tools on the first row, the brush slider full width below. */}
            <div className="glass-strong flex flex-wrap items-center gap-1.5 rounded-[14px] p-1.5 max-sm:w-full">
              <Segmented
                ariaLabel="涂抹工具"
                value={erase ? "erase" : "brush"}
                onValueChange={(v) => setErase(v === "erase")}
                options={[
                  { value: "brush", label: <span className="inline-flex items-center gap-1.5"><BrushIcon className="size-3.5" strokeWidth={2} />画笔</span> },
                  { value: "erase", label: <span className="inline-flex items-center gap-1.5"><EraserIcon className="size-3.5" strokeWidth={2} />擦除</span> },
                ]}
              />
              <label className="order-last flex items-center gap-2 px-2 text-[12.5px] font-semibold text-fg-soft max-sm:w-full sm:order-none">
                笔刷
                <input
                  type="range"
                  min={BRUSH_MIN}
                  max={BRUSH_MAX}
                  step={4}
                  value={brush}
                  onChange={(e) => setBrush(Number(e.target.value))}
                  aria-label="笔刷大小"
                  className="min-w-0 flex-1 accent-[var(--acc)] sm:w-32 sm:flex-none"
                />
                <span className="numeral w-8 text-right text-[15px] text-fg">{brush}</span>
              </label>
              <span className="mx-0.5 h-5 w-px bg-line max-sm:hidden" aria-hidden />
              <span className="flex items-center gap-1.5 max-sm:ml-auto">
                <ToolButton label="撤销（Ctrl/⌘ Z）" onClick={undo} disabled={!strokes.length}>
                  <Undo2Icon />
                </ToolButton>
                <ToolButton label="重做（Shift Ctrl/⌘ Z）" onClick={redoStroke} disabled={!redo.length}>
                  <Redo2Icon />
                </ToolButton>
                <ToolButton
                  label="清空涂抹"
                  onClick={() => {
                    setStrokes([]);
                    setRedo([]);
                  }}
                  disabled={!strokes.length}
                >
                  <Trash2Icon />
                </ToolButton>
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <aside className="flex min-h-0 flex-col border-t border-line md:border-t-0 md:border-l">
        <div className="shrink-0 px-5 pt-5 pr-14 sm:px-6 sm:pr-14">
          <DialogTitle className="sr-only">修改这张图</DialogTitle>
          <PosterTabs
            value={mode}
            onValueChange={setMode}
            tabs={MODES.map((value) => ({ value, label: IMAGE_EDIT_LABEL[value] }))}
            ariaLabel="修改方式"
            idPrefix="edit"
          />
          <DialogDescription className="mt-3 text-[13px] leading-relaxed text-fg-soft">
            {mode === "inpaint"
              ? "在图上涂出要修改的地方，写下改成什么。没涂的地方尽量保持原样。"
              : "把画面往外扩：选新的比例、放大多少和原图的位置，模型补全新增的部分。"}
          </DialogDescription>
        </div>

        <div
          {...posterPanelProps("edit", mode)}
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pt-5 pb-4 sm:px-6"
        >
          {mode === "outpaint" ? (
            <>
              <Field label="比例" note={ask.aspectRatio !== outRatio ? `当前模型用 ${ask.aspectRatio}` : `原图约 ${ownRatio}`}>
                <RatioGrid value={ask.aspectRatio} onValueChange={setOutRatio} supported={caps.aspectRatios} />
              </Field>
              <Field label="放大">
                <Segmented
                  ariaLabel="放大"
                  value={String(scale)}
                  onValueChange={(v) => setScale(Number(v) as (typeof OUTPAINT_SCALES)[number])}
                  options={OUTPAINT_SCALES.map((value) => ({ value: String(value), label: OUTPAINT_SCALE_LABEL[value] }))}
                  className="flex w-full"
                />
              </Field>
              <Field label="原图位置">
                <AnchorPad value={anchor} onValueChange={setAnchor} />
              </Field>
            </>
          ) : null}

          <Field label={mode === "inpaint" ? "改成什么" : "新画面（可不填）"} htmlFor="edit-prompt">
            <div className="rounded-[14px] bg-panel/75 px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--acc),0_0_0_3px_var(--acc-soft)]">
              <textarea
                id="edit-prompt"
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
                placeholder={mode === "inpaint" ? "比如：把杯子换成红色陶瓷杯" : `不填就${DEFAULT_OUTPAINT_PROMPT}`}
                className="block min-h-[76px] w-full resize-none bg-transparent text-[15px] leading-[1.7] text-fg caret-acc placeholder:text-fg-muted focus:outline-none"
              />
            </div>
          </Field>

          <Field label="模型" inline>
            <Picker
              ariaLabel="模型"
              value={model}
              onValueChange={setModel}
              options={modelOptions}
              placeholder="没有可用模型"
              disabled={capable.length === 0}
              className="h-11 w-full rounded-[12px] bg-panel/75 text-[14px]"
              popupClassName="w-[300px]"
            />
          </Field>

          <Field
            label="画质"
            note={
              ask.resolution !== resolution && caps.resolutions.includes(resolution)
                ? `${ask.aspectRatio} 最小 ${ask.resolution}，按 ${ask.resolution} 出图`
                : RESOLUTION_HINT[ask.resolution]
            }
          >
            <Segmented
              ariaLabel="画质"
              size="lg"
              value={ask.resolution}
              onValueChange={(v) => setResolution(v as typeof resolution)}
              options={RESOLUTIONS.map((value) => {
                const reason = resolutionUnavailable(caps, value, ask.aspectRatio);
                return { value, label: value, disabled: reason !== null, ...(reason ? { title: reason } : {}) };
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
              {busy ? (
                <>
                  <LiveDot className="bg-acc-ink" />
                  正在提交
                </>
              ) : (
                <>
                  {mode === "inpaint" ? "重绘" : "扩图"}
                  <span className="numeral text-[26px]">{count}</span>张
                  <ArrowRightIcon strokeWidth={2.4} />
                </>
              )}
            </Button>
          </div>
          <p className="mt-3 min-h-[1.5em] text-[12.5px] leading-relaxed text-fg-muted" aria-live="polite">
            {blockedReason ?? "每张单独发一次请求，不会自动重发。"}
          </p>
        </div>
      </aside>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-9 items-center justify-center rounded-[10px] text-fg-soft transition-colors hover:bg-tint/[0.08] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc disabled:cursor-not-allowed disabled:opacity-35 [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

/** 3 × 3 pad for where the original sits in the new frame. */
function AnchorPad({
  value,
  onValueChange,
}: {
  value: OutpaintAnchor;
  onValueChange: (value: OutpaintAnchor) => void;
}) {
  return (
    <div role="radiogroup" aria-label="原图位置" className="grid w-[132px] grid-cols-3 gap-1.5">
      {OUTPAINT_ANCHORS.map((anchor, index) => {
        const active = anchor === value;
        return (
          <button
            key={anchor}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={ANCHOR_LABEL[anchor]}
            title={ANCHOR_LABEL[anchor]}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(anchor)}
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 3 : event.key === "ArrowUp" ? -3 : 0;
              if (!step) return;
              event.preventDefault();
              const next = OUTPAINT_ANCHORS[index + step];
              if (!next) return;
              onValueChange(next);
              const pad = event.currentTarget.parentElement;
              requestAnimationFrame(() => pad?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
            }}
            className={cn(
              "flex aspect-square items-center justify-center rounded-[9px] transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
              active ? "bg-fg" : "bg-tint/[0.07] hover:bg-tint/[0.12]",
            )}
          >
            <span className={cn("size-2.5 rounded-[3px]", active ? "bg-acc" : "bg-fg-muted/60")} />
          </button>
        );
      })}
    </div>
  );
}

/** The new frame with the original placed in it; new room is striped. */
function OutpaintPreview({
  src,
  frame,
  ratio,
}: {
  src: string;
  frame: ReturnType<typeof outpaintFrame>;
  ratio: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const value = aspectRatioValue(ratio) ?? 1;
  const box = useFitBox(stage, frame?.width ?? value * 1000, frame?.height ?? 1000);
  return (
    <div ref={stage} className="flex h-full w-full items-center justify-center">
      {box ? (
        <div
          className="relative overflow-hidden rounded-[12px] bg-[repeating-linear-gradient(135deg,var(--acc-soft)_0_14px,transparent_14px_28px)] shadow-[inset_0_0_0_1.5px_var(--acc)]"
          style={{ width: box.width, height: box.height }}
        >
          {frame ? (
            <img
              src={src}
              alt="原图"
              draggable={false}
              className="absolute select-none object-fill shadow-lit transition-[left,top,width,height] duration-300"
              style={{
                left: `${(frame.left / frame.width) * 100}%`,
                top: `${(frame.top / frame.height) * 100}%`,
                width: `${(frame.sourceWidth / frame.width) * 100}%`,
                height: `${(frame.sourceHeight / frame.height) * 100}%`,
              }}
            />
          ) : (
            <img src={src} alt="原图" draggable={false} className="h-full w-full select-none object-fill" />
          )}
        </div>
      ) : null}
    </div>
  );
}
