"use client";

/**
 * Inline generator attached to an image-generator placeholder on the canvas.
 *
 * Billing rules:
 * - One click sends exactly one request; nothing is retried automatically.
 * - Closing the panel does NOT abandon an in-flight request: the main site
 *   may already be charging for it, so the result is still placed on the
 *   canvas when it returns (tracked in `inFlight`, outside React state).
 * - A placeholder left in `generating` with no live request (page reloaded
 *   mid-request) is shown as "unknown, go reconcile", never re-sent.
 */
import { ArrowUpIcon, ImagePlusIcon, RotateCwIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ATTACHMENT_ACCEPT, useImageAttachments } from "../../hooks/use-image-attachments";
import { useAccount, useImageModels } from "../../lib/account-context";
import {
  type ImageGeneratorData,
  resizeImageGeneratorElement,
  updateImageGeneratorElement,
} from "../../lib/canvas-image-generator";
import { createExcalidrawImageElement, fetchAsDataURL } from "../../lib/canvas-elements";
import { type IssueSpec, describeIssue } from "../../lib/generation-errors";
import { ASPECT_RATIOS, QUALITY_LABEL, maxReferenceImages } from "../../lib/image-model-meta";
import { type ImageQuality, generateImageDirect } from "../../lib/server-api";
import { cn } from "../../lib/utils";
import { LiveDot } from "../ambient/live-dot";
import { useIssues } from "../issues/issue-provider";
import { useToast } from "../toast";
import { Picker, Segmented } from "../ui/select";

type ImageGeneratorPanelProps = {
  elementId: string;
  elementBounds: { x: number; y: number; width: number; height: number };
  data: ImageGeneratorData;
  excalidrawApi: any;
  accessToken: string;
  canvasScrollZoom: { scrollX: number; scrollY: number; zoom: number };
  onClose: () => void;
};

const PANEL_WIDTH = 460;
/** Room kept free at the bottom of the screen for the canvas toolbar. */
const TOOLBAR_CLEARANCE = 72;
/** On phones the zoom bar sits above the toolbar; dock above both. */
const PHONE_DOCK_BOTTOM = 120;
const PROMPT_MAX = 4000;

/** Placeholders with a live request in this tab. Survives panel unmounts. */
const inFlight = new Set<string>();

/** False for a placeholder stuck in `generating` from an earlier page load. */
export function isGenerationInFlight(elementId: string): boolean {
  return inFlight.has(elementId);
}

type PanelState =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "error"; spec: IssueSpec }
  | { kind: "insert_failed" }
  | { kind: "stale" };

function generateId(): string {
  return (
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  ).slice(0, 20);
}

export function ImageGeneratorPanel({
  elementId,
  elementBounds,
  data,
  excalidrawApi,
  accessToken,
  canvasScrollZoom,
  onClose,
}: ImageGeneratorPanelProps) {
  const { data: modelList, loading: modelsLoading, error: modelsError } = useImageModels();
  const { account, notifyGenerationSettled, refreshImageModels } = useAccount();
  const { report } = useIssues();
  const { error: toastError } = useToast();
  const models = useMemo(() => modelList ?? [], [modelList]);

  const [prompt, setPrompt] = useState(data.prompt);
  const [model, setModel] = useState<string | null>(data.model || null);
  const [aspectRatio, setAspectRatio] = useState(data.aspectRatio);
  const [quality, setQuality] = useState<ImageQuality>(
    data.quality === "hd" ? "hd" : "standard",
  );
  const [state, setState] = useState<PanelState>(() => {
    if (data.status !== "generating") return { kind: "idle" };
    return inFlight.has(elementId) ? { kind: "generating" } : { kind: "stale" };
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  const {
    attachments,
    addFiles,
    retryUpload,
    removeAttachment,
    isUploading,
    readyAttachments,
  } = useImageAttachments(accessToken, undefined, {
    onReject: toastError,
  });

  // Resolve the model once the list arrives: the placeholder's choice if the
  // key can still reach it, else the account default, else the first one.
  const preferred = account.data?.preferences.default_image_model ?? null;
  useEffect(() => {
    if (models.length === 0) return;
    setModel((current) => {
      if (current && models.some((m) => m.id === current)) return current;
      if (preferred && models.some((m) => m.id === preferred)) return preferred;
      return models[0]!.id;
    });
  }, [models, preferred]);

  const current = models.find((m) => m.id === model) ?? null;
  const supportsHd = current?.maxQuality !== "standard";
  const effectiveQuality: ImageQuality = supportsHd ? quality : "standard";
  const refLimit = maxReferenceImages(model);
  const overRefLimit = attachments.length > refLimit;

  // Auto-size the prompt.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [prompt]);

  useEffect(() => {
    if (state.kind === "idle") textareaRef.current?.focus();
    // Only on first open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeRatio = useCallback(
    (ratio: string) => {
      setAspectRatio(ratio);
      resizeImageGeneratorElement(excalidrawApi, elementId, ratio);
      updateImageGeneratorElement(excalidrawApi, elementId, { aspectRatio: ratio });
    },
    [excalidrawApi, elementId],
  );

  const changeQuality = useCallback(
    (next: string) => {
      const value: ImageQuality = next === "hd" ? "hd" : "standard";
      setQuality(value);
      updateImageGeneratorElement(excalidrawApi, elementId, { quality: value });
    },
    [excalidrawApi, elementId],
  );

  const changeModel = useCallback(
    (next: string) => {
      setModel(next);
      updateImageGeneratorElement(excalidrawApi, elementId, { model: next });
    },
    [excalidrawApi, elementId],
  );

  const generating = state.kind === "generating";
  const trimmed = prompt.trim();
  const blockedReason = modelsError
    ? null // the key problem is explained below the toolbar
    : !current
      ? modelsLoading
        ? "正在读取可用模型"
        : "当前 Key 没有可用的生图模型"
      : isUploading
        ? "参考图还在上传"
        : overRefLimit
          ? refLimit === 0
            ? `${current.displayName} 不支持参考图`
            : `${current.displayName} 最多 ${refLimit} 张参考图`
          : attachments.some((a) => a.error)
            ? "有参考图上传失败，重试或移除后再生成"
            : null;
  const canGenerate =
    Boolean(trimmed) && Boolean(current) && !blockedReason && !generating && !inFlight.has(elementId);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate || !model) return;
    inFlight.add(elementId);
    setState({ kind: "generating" });
    const params = {
      prompt: trimmed,
      model,
      aspectRatio,
      quality: effectiveQuality,
    };
    updateImageGeneratorElement(excalidrawApi, elementId, {
      status: "generating",
      ...params,
    });
    console.info("[image-gen] request sent", { elementId, model, quality: effectiveQuality });

    let result: Awaited<ReturnType<typeof generateImageDirect>>;
    try {
      result = await generateImageDirect(tokenRef.current, trimmed, {
        model,
        aspectRatio,
        quality: effectiveQuality,
        ...(readyAttachments.length
          ? { inputImages: readyAttachments.map((a) => a.url) }
          : {}),
      });
    } catch (error) {
      inFlight.delete(elementId);
      notifyGenerationSettled();
      const spec = report(error);
      if (spec?.action === "reload_models") void refreshImageModels();
      updateImageGeneratorElement(excalidrawApi, elementId, {
        status: "error",
        errorMessage: spec?.title ?? "生成失败",
      });
      if (mounted.current && spec) setState({ kind: "error", spec });
      return;
    }
    notifyGenerationSettled();

    // The image is paid for from here on: place it even if the panel closed.
    try {
      const dataURL = await fetchAsDataURL(result.url);
      const fileId = generateId();
      excalidrawApi.addFiles([
        { id: fileId, dataURL, mimeType: result.mimeType, created: Date.now() },
      ]);
      const imageElement = createExcalidrawImageElement({
        fileId,
        x: elementBounds.x,
        y: elementBounds.y,
        width: elementBounds.width,
        height: elementBounds.height,
        title: trimmed.slice(0, 60),
      });
      const elements = excalidrawApi
        .getSceneElements()
        .map((el: any) => (el.id === elementId ? { ...el, isDeleted: true } : el));
      excalidrawApi.updateScene({
        elements: [...elements, imageElement],
        captureUpdate: "IMMEDIATELY",
      });
      console.info("[image-gen] placed on canvas", { elementId, assetId: result.assetId });
      inFlight.delete(elementId);
      if (mounted.current) onClose();
    } catch (error) {
      inFlight.delete(elementId);
      console.error("[image-gen] generated but could not place on canvas", error);
      updateImageGeneratorElement(excalidrawApi, elementId, {
        status: "error",
        errorMessage: "已生成，插入失败",
      });
      if (mounted.current) setState({ kind: "insert_failed" });
    }
  }, [
    canGenerate,
    model,
    trimmed,
    aspectRatio,
    effectiveQuality,
    excalidrawApi,
    elementId,
    elementBounds,
    readyAttachments,
    notifyGenerationSettled,
    report,
    refreshImageModels,
    onClose,
  ]);

  // Measured so the panel can flip above the placeholder when it would run
  // off the bottom of the screen.
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(180);
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    setPanelHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setPanelHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Desktop: under the placeholder, flipped above it when there's no room,
  // always inside the viewport and clear of the bottom toolbar.
  // Phones: docked full-width just above the toolbar; a panel hanging off a
  // placeholder doesn't fit on a 390px screen.
  const { scrollX, scrollY, zoom } = canvasScrollZoom;
  const isBrowser = typeof window !== "undefined";
  const docked = isBrowser && window.innerWidth < 640;
  const rawLeft = (elementBounds.x + scrollX) * zoom;
  const below = (elementBounds.y + elementBounds.height + scrollY) * zoom + 10;
  const above = (elementBounds.y + scrollY) * zoom - 10 - panelHeight;
  const maxTop = isBrowser ? window.innerHeight - TOOLBAR_CLEARANCE - panelHeight : below;
  const top = below <= maxTop ? below : above >= 8 ? above : Math.max(8, maxTop);
  const left = isBrowser
    ? Math.max(8, Math.min(rawLeft, window.innerWidth - PANEL_WIDTH - 8))
    : rawLeft;
  const position: React.CSSProperties = docked
    ? { left: 8, right: 8, bottom: PHONE_DOCK_BOTTOM }
    : { left, top, width: `min(${PANEL_WIDTH}px, calc(100vw - 16px))` };

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
  const ratioOptions = useMemo(
    () => ASPECT_RATIOS.map((r) => ({ value: r, text: r, label: r })),
    [],
  );

  return createPortal(
    <div
      ref={panelRef}
      style={position}
      className="glass-strong fixed z-[100] rounded-lg shadow-float"
      onKeyDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="生成图片"
    >
      {attachments.length > 0 ? (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-3 py-2.5">
          {attachments.map((att) => (
            <div key={att.id} className="group relative size-11 shrink-0">
              <img
                src={att.preview}
                alt={att.name ?? "参考图"}
                className={cn(
                  "size-full rounded-frame object-cover",
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
                  className="absolute inset-0 flex items-center justify-center rounded-frame bg-alert-wash text-alert"
                >
                  <RotateCwIcon className="size-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => removeAttachment(att.id)}
                aria-label="移除参考图"
                className="absolute -top-1.5 -right-1.5 hidden size-4.5 items-center justify-center rounded-full bg-fg text-ground group-hover:flex focus-visible:flex"
              >
                <XIcon className="size-2.5" strokeWidth={2.5} />
              </button>
            </div>
          ))}
          <span
            className={cn(
              "data-label ml-1 shrink-0",
              overRefLimit ? "text-alert" : "text-fg-muted",
            )}
          >
            {attachments.length}/{refLimit}
          </span>
        </div>
      ) : null}

      <label htmlFor={`gen-prompt-${elementId}`} className="sr-only">
        提示词
      </label>
      <textarea
        id={`gen-prompt-${elementId}`}
        ref={textareaRef}
        value={prompt}
        maxLength={PROMPT_MAX}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void handleGenerate();
          }
        }}
        placeholder="描述你想要的画面"
        disabled={generating}
        className="block max-h-[140px] min-h-[76px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-muted disabled:opacity-60"
      />

      <PanelNotice state={state} modelsError={modelsError} blockedReason={trimmed ? blockedReason : null} />

      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-1 pb-2.5">
        <Picker
          value={model}
          onValueChange={changeModel}
          options={modelOptions}
          ariaLabel="生图模型"
          placeholder={modelsLoading ? "读取模型…" : "无可用模型"}
          disabled={generating || models.length === 0}
          side="top"
          className="h-8 max-w-[150px] border-transparent bg-transparent px-2 hover:bg-white/[0.06]"
          popupClassName="w-[280px]"
        />
        <input
          ref={refInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => refInputRef.current?.click()}
          disabled={generating || refLimit === 0}
          title={refLimit === 0 ? "当前模型不支持参考图" : "添加参考图"}
          aria-label="添加参考图"
          className="flex size-8 items-center justify-center rounded-md text-fg-soft transition-colors hover:bg-white/[0.06] hover:text-fg disabled:cursor-not-allowed disabled:text-line-strong disabled:hover:bg-transparent"
        >
          <ImagePlusIcon className="size-4" strokeWidth={1.75} />
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <Segmented
            value={effectiveQuality}
            onValueChange={changeQuality}
            ariaLabel="清晰度"
            className="h-8"
            options={[
              { value: "standard", label: "1K" },
              {
                value: "hd",
                label: "2K",
                disabled: !supportsHd || generating,
                title: supportsHd ? "2K" : "当前模型只支持 1K",
              },
            ]}
          />
          <Picker
            value={aspectRatio}
            onValueChange={changeRatio}
            options={ratioOptions}
            ariaLabel="画面比例"
            disabled={generating}
            side="top"
            align="end"
            className="h-8 w-[76px] tabular"
          />
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={!canGenerate}
            aria-label={generating ? "生成中" : "生成"}
            title={blockedReason ?? "生成（Enter）"}
            className="flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md bg-alert px-2.5 text-[13px] font-medium text-ground transition-colors hover:bg-alert disabled:cursor-not-allowed disabled:bg-line-strong"
          >
            {generating ? (
              <LiveDot className="bg-panel" />
            ) : (
              <ArrowUpIcon className="size-4" strokeWidth={2} />
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PanelNotice({
  state,
  modelsError,
  blockedReason,
}: {
  state: PanelState;
  modelsError: string | null;
  blockedReason: string | null;
}) {
  if (state.kind === "generating") {
    return (
      <p className="flex items-center gap-2 px-3.5 pb-1.5 text-[12.5px] text-fg-soft">
        <LiveDot />
        生成中，慢的模型要几分钟。关闭面板不会中断，结果会落到画布上。
      </p>
    );
  }
  if (state.kind === "stale") {
    return (
      <Notice tone="warn">
        上次生成在页面关闭前没有返回结果，可能已经扣费。先到
        <Link href="/studio" className="mx-0.5 underline underline-offset-2">生图</Link>
        核对生成记录，再决定是否重新生成。
      </Notice>
    );
  }
  if (state.kind === "insert_failed") {
    return (
      <Notice tone="warn">
        图片已经生成，但没能放到画布上。可以在
        <Link href="/studio" className="mx-0.5 underline underline-offset-2">生图</Link>
        找到它并下载。
      </Notice>
    );
  }
  if (state.kind === "error") {
    return (
      <Notice tone="error">
        <span className="font-semibold">{state.spec.title}</span>
        <span className="ml-1">{state.spec.maybeCharged ? "可能已扣费，请先核对再重试。" : state.spec.message}</span>
      </Notice>
    );
  }
  if (modelsError) {
    const spec = describeIssue(modelsError, null);
    return (
      <Notice tone="warn">
        {spec.title}。
        <Link href="/settings?tab=keys" className="ml-0.5 underline underline-offset-2">
          去选择 Key
        </Link>
      </Notice>
    );
  }
  if (blockedReason) {
    return <p className="px-3.5 pb-1.5 text-[12px] text-fg-muted">{blockedReason}</p>;
  }
  return null;
}

function Notice({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "mx-2.5 mb-1.5 rounded-md px-3 py-2 text-[12.5px] leading-relaxed",
        tone === "error" ? "bg-alert-wash text-alert" : "bg-white/[0.05] text-fg-soft",
      )}
    >
      {children}
    </p>
  );
}
