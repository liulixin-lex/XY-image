"use client";

import {
  ArrowUpRightIcon,
  BrushIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  Clock3Icon,
  DownloadIcon,
  EyeIcon,
  ImageIcon,
  type LucideIcon,
  PaletteIcon,
  SearchIcon,
  SquareIcon,
  VideoIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ToolBlock } from "@loomic/shared";
import { LiveDot } from "@/components/ambient/live-dot";
import { cn } from "@/lib/utils";
import { ChatImage } from "./image-lightbox";
import { type MediaOutcome, describeMediaOutcome } from "./media-outcome";
import {
  formatModelDisplayName,
  formatOutputPreview,
  formatParamName,
  formatParamValue,
  getToolConfig,
  isHumanReadable,
} from "./utils";

/* ------------------------------------------------------------------ */
/*  ToolIcon                                                           */
/* ------------------------------------------------------------------ */

const TOOL_ICONS: Record<string, LucideIcon> = {
  eye: EyeIcon,
  image: ImageIcon,
  video: VideoIcon,
  palette: PaletteIcon,
  search: SearchIcon,
  brush: BrushIcon,
};

function ToolIcon({ type, className }: { type: string; className?: string }) {
  const Icon = TOOL_ICONS[type] ?? WrenchIcon;
  return (
    <Icon aria-hidden className={className ?? "size-3.5"} strokeWidth={1.75} />
  );
}

/* ------------------------------------------------------------------ */
/*  findSidebarRect — locate the chatbar container for panel placement */
/* ------------------------------------------------------------------ */

function findSidebarRect(el: HTMLElement | null): DOMRect | null {
  let node = el;
  while (node) {
    if (node.style.width && node.classList.contains("shrink-0")) {
      return node.getBoundingClientRect();
    }
    node = node.parentElement;
  }
  return null;
}

/** Detail panel width; below this much free space it centres instead. */
const DETAIL_PANEL_WIDTH = 520;

/** Where the chat sends people to look a request up (settings 生成记录). */
const RECORDS_HREF = "/settings?tab=records";

/* ------------------------------------------------------------------ */
/*  ToolBlockView — main card in chatbar + floating detail panel       */
/* ------------------------------------------------------------------ */

export const ToolBlockView = React.memo(function ToolBlockView({
  block,
  live = false,
}: {
  block: ToolBlock;
  /** The message is still streaming: a picture arriving now gets its stamp. */
  live?: boolean;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  // null = centred (phones, narrow windows); a number = beside the sidebar.
  const [panelRight, setPanelRight] = useState<number | null>(416);
  const containerRef = useRef<HTMLDivElement>(null);

  const config = getToolConfig(block.toolName);
  const isCompleted = block.status === "completed";
  const hasOutput = block.output && Object.keys(block.output).length > 0;
  const hasInput = block.input && Object.keys(block.input).length > 0;
  const hasDetails = hasOutput || hasInput;

  const hasReadableSummary =
    !!block.outputSummary && isHumanReadable(block.outputSummary);
  const cardTitle =
    hasReadableSummary && block.outputSummary
      ? block.outputSummary
      : config.label;

  const previewLines = hasOutput ? formatOutputPreview(block.output!) : [];
  const showCard =
    config.showCard && isCompleted && (block.outputSummary || hasOutput);

  // Extract artifacts for generate_image / generate_video inline preview
  const imageArtifact = block.artifacts?.find(
    (a: { type: string }) => a.type === "image",
  );
  const isImageTool = block.toolName === "generate_image";
  const isVideoTool = block.toolName === "generate_video";
  const isMediaTool = isImageTool || isVideoTool;
  const mediaOutput = block.output as Record<string, unknown> | undefined;
  // A finished media call without a picture: saving, still on its way,
  // stopped, 待核对 or not made (media-outcome.ts).
  const outcome =
    isMediaTool && isCompleted && !imageArtifact
      ? describeMediaOutcome(mediaOutput, isVideoTool ? "video" : "image")
      : null;
  // The worker or the run placed it (the element id comes back with it).
  const placed = typeof mediaOutput?.elementId === "string";
  const inputData = block.input as Record<string, unknown> | undefined;
  const modelName = inputData?.model as string | undefined;
  const aspectRatio =
    (inputData?.aspectRatio as string) ?? (isVideoTool ? "16:9" : "1:1");

  const handleOpenPanel = useCallback(() => {
    // Beside the sidebar when the canvas has room for it; otherwise (phones,
    // where the sidebar covers the canvas) centred in the viewport.
    const rect = findSidebarRect(containerRef.current);
    const right = rect ? window.innerWidth - rect.left + 12 : 416;
    setPanelRight(
      window.innerWidth - right >= DETAIL_PANEL_WIDTH + 12 ? right : null,
    );
    setPanelOpen(true);
  }, []);

  const handleClosePanel = useCallback(() => setPanelOpen(false), []);

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Layer 1: status line */}
      <div className="flex items-center gap-1.5 text-[12px] text-fg-muted">
        <StatusIcon running={block.status === "running"} outcome={outcome} />
        <span className="truncate font-medium">
          {isMediaTool && modelName
            ? formatModelDisplayName(modelName)
            : config.label}
        </span>
      </div>

      {/* Layer 2a: a picture on its way */}
      {isMediaTool && !isCompleted && (
        <MediaRunning aspectRatio={aspectRatio} modelName={modelName} />
      )}

      {/* Layer 2b: finished without a picture */}
      {outcome ? <MediaOutcomeCard outcome={outcome} /> : null}

      {/* Layer 2c: the picture */}
      {isImageTool && isCompleted && imageArtifact ? (
        <ImageArtifactCard
          artifact={imageArtifact}
          cardTitle={cardTitle}
          modelName={modelName}
          hasDetails={!!hasDetails}
          placed={placed}
          live={live}
          onOpenPanel={handleOpenPanel}
        />
      ) : showCard && !outcome ? (
        /* Layer 2: generic output card (non-media tools). */
        <div className="rounded-[14px] bg-tint/[0.045] p-3">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-panel text-fg-soft shadow-subtle">
              <ToolIcon type={config.icon} className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-fg">
                {cardTitle}
              </div>
              {/* Raw key/value lines only when there is no readable summary. */}
              {!hasReadableSummary && previewLines.length > 0 && (
                <div className="mt-1 space-y-px">
                  {previewLines.map((line, i) => (
                    <div
                      key={i}
                      className="truncate text-[11.5px] text-fg-muted"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              )}
              {hasDetails && (
                <button
                  type="button"
                  onClick={handleOpenPanel}
                  className="mt-1.5 inline-flex items-center gap-0.5 rounded-[6px] text-[12px] font-medium text-fg-soft transition-colors hover:text-acc-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
                >
                  查看详情
                  <ChevronRightIcon
                    aria-hidden
                    className="size-3.5"
                    strokeWidth={2}
                  />
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Floating detail panel */}
      {panelOpen &&
        hasDetails &&
        createPortal(
          <ToolDetailPanel
            block={block}
            rightOffset={panelRight}
            onClose={handleClosePanel}
          />,
          document.body,
        )}
    </div>
  );
});

function StatusIcon({
  running,
  outcome,
}: {
  running: boolean;
  outcome: MediaOutcome | null;
}) {
  if (running) return <LiveDot className="mx-[3px] size-1.5" />;
  switch (outcome?.tone) {
    case "saving":
      return <Clock3Icon aria-hidden className="size-3.5" strokeWidth={2} />;
    case "waiting":
      return <LiveDot className="mx-[3px] size-1.5" />;
    case "stopped":
    case "canceled":
      return (
        <SquareIcon
          aria-hidden
          className="size-3"
          fill="currentColor"
          strokeWidth={0}
        />
      );
    case "unknown":
      return (
        <CircleAlertIcon
          aria-hidden
          className="size-3.5 text-warn"
          strokeWidth={2}
        />
      );
    case "charged_failed":
    case "failed":
      return (
        <CircleAlertIcon
          aria-hidden
          className="size-3.5 text-alert"
          strokeWidth={2}
        />
      );
    default:
      return <CheckIcon aria-hidden className="size-3.5" strokeWidth={2.25} />;
  }
}

/* ------------------------------------------------------------------ */
/*  MediaRunning — the picture is on its way (studio's running tile)   */
/* ------------------------------------------------------------------ */

const MediaRunning = React.memo(function MediaRunning({
  aspectRatio,
  modelName,
}: {
  aspectRatio: string;
  modelName: string | undefined;
}) {
  return (
    <output className="block overflow-hidden rounded-[14px] bg-tint/[0.03]">
      <div
        className="flex max-h-[260px] w-full flex-col items-center justify-center gap-1.5 bg-[repeating-linear-gradient(135deg,var(--acc-soft)_0_14px,transparent_14px_28px)] px-4 text-center"
        style={{ aspectRatio: aspectRatio.replace(":", " / ") }}
      >
        <span className="font-display text-[20px] leading-none text-fg">
          生成中
        </span>
        <span className="text-[12px] text-fg-soft">好了会自动放到画布上</span>
        <span
          aria-hidden
          className="mt-2.5 h-1 w-[min(60%,160px)] overflow-hidden rounded-full bg-tint/[0.1]"
        >
          <span className="block h-full w-2/5 animate-progress rounded-full bg-acc" />
        </span>
      </div>
      {modelName ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-fg-muted">
          <span className="data-label truncate">
            {formatModelDisplayName(modelName)}
          </span>
          <span className="data-label shrink-0">{aspectRatio}</span>
        </div>
      ) : null}
    </output>
  );
});

/* ------------------------------------------------------------------ */
/*  MediaOutcomeCard — finished without a picture                      */
/* ------------------------------------------------------------------ */

const OUTCOME_SURFACE: Record<MediaOutcome["tone"], string> = {
  saving: "bg-ok-wash",
  waiting: "bg-tint/[0.045]",
  stopped: "bg-tint/[0.045]",
  canceled: "bg-tint/[0.045]",
  unknown: "bg-warn-wash",
  charged_failed: "bg-tint/[0.045]",
  failed: "bg-tint/[0.045]",
};

const MediaOutcomeCard = React.memo(function MediaOutcomeCard({
  outcome,
}: {
  outcome: MediaOutcome;
}) {
  const lookUp =
    outcome.tone === "unknown" || outcome.tone === "charged_failed";
  return (
    <div
      className={cn(
        "rounded-[14px] px-3.5 py-3",
        OUTCOME_SURFACE[outcome.tone],
      )}
    >
      <p
        className={cn(
          "text-[13.5px] font-semibold leading-snug",
          outcome.tone === "unknown" ? "text-warn" : "text-fg",
        )}
      >
        {outcome.title}
      </p>
      {outcome.message ? (
        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-soft">
          {outcome.message}
        </p>
      ) : null}
      {lookUp ? (
        <a
          href={RECORDS_HREF}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "mt-2.5 inline-flex h-8 items-center gap-1 rounded-[9px] px-3 text-[12.5px] font-semibold transition-[opacity,background-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
            outcome.tone === "unknown"
              ? "bg-warn text-ground hover:opacity-90"
              : "bg-tint/[0.07] text-fg hover:bg-tint/[0.12]",
          )}
        >
          打开生成记录
          <ArrowUpRightIcon aria-hidden className="size-3.5" strokeWidth={2} />
        </a>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  ImageArtifactCard                                                  */
/* ------------------------------------------------------------------ */

/** Keep tall and wide results recognisable without letting them take over the sidebar. */
function previewAspect(width?: number, height?: number): number {
  if (!width || !height) return 1;
  return Math.min(16 / 9, Math.max(4 / 5, width / height));
}

function downloadExtension(mimeType?: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/**
 * The poster sticker from the landing page, stamped onto a picture the
 * moment it lands on the canvas. Static for pictures already there (history,
 * reloads) and with reduced motion.
 */
function CanvasStamp({ stamp }: { stamp: boolean }) {
  // CSS `.animate-stamp` (globals.css): a springy drop, off under reduced motion.
  return (
    <span
      className={cn(
        "pointer-events-none absolute bottom-3 left-3 -rotate-6 rounded-[8px] bg-acc px-2.5 py-1.5 font-display text-[13px] leading-none text-acc-ink shadow-acc",
        stamp && "animate-stamp",
      )}
    >
      已放到画布
    </span>
  );
}

const ImageArtifactCard = React.memo(function ImageArtifactCard({
  artifact,
  cardTitle,
  modelName,
  hasDetails,
  placed,
  live,
  onOpenPanel,
}: {
  artifact: {
    url: string;
    title?: string | undefined;
    type: string;
    width?: number | undefined;
    height?: number | undefined;
    mimeType?: string | undefined;
  };
  cardTitle: string;
  modelName: string | undefined;
  hasDetails: boolean;
  placed: boolean;
  live: boolean;
  onOpenPanel: () => void;
}) {
  const title = artifact.title ?? cardTitle;

  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      fetch(artifact.url)
        .then((res) => res.blob())
        .then((blob) => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `${artifact.title ?? "gguu-image"}.${downloadExtension(artifact.mimeType)}`;
          a.click();
          URL.revokeObjectURL(a.href);
        })
        .catch((err) => {
          console.warn(
            "[chat] image download failed, opening in a new tab",
            err,
          );
          window.open(artifact.url, "_blank", "noopener");
        });
    },
    [artifact.url, artifact.title, artifact.mimeType],
  );

  // The card opens the detail panel; download is a sibling button (no
  // nested interactive elements), shown on hover / focus and always on touch.
  return (
    <div className="group relative overflow-hidden rounded-[14px] bg-panel shadow-card transition-shadow hover:shadow-card-hover">
      <button
        type="button"
        onClick={onOpenPanel}
        aria-label={`查看「${title}」的详情${placed ? "，已放到画布" : ""}`}
        className="block w-full cursor-pointer text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acc"
      >
        <span
          className="relative block max-h-[320px] w-full overflow-hidden bg-well"
          style={{
            aspectRatio: previewAspect(artifact.width, artifact.height),
          }}
        >
          <img
            src={artifact.url}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            loading="lazy"
          />
          {placed ? <CanvasStamp stamp={live} /> : null}
        </span>
        <span className="flex items-center gap-3 px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold text-fg">
              {title}
            </span>
            {modelName ? (
              <span className="data-label mt-0.5 block truncate text-fg-muted">
                {formatModelDisplayName(modelName)}
              </span>
            ) : null}
          </span>
          {hasDetails ? (
            <span className="inline-flex shrink-0 items-center text-[12px] font-medium text-fg-soft transition-colors group-hover:text-acc-text">
              详情
              <ChevronRightIcon
                aria-hidden
                className="size-3.5"
                strokeWidth={2}
              />
            </span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        onClick={handleDownload}
        aria-label="下载图片"
        title="下载图片"
        className="absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-[10px] bg-black/40 text-white opacity-0 backdrop-blur-md transition-[opacity,background-color] group-hover:opacity-100 hover:bg-black/60 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white [@media(hover:none)]:opacity-100"
      >
        <DownloadIcon aria-hidden className="size-4" strokeWidth={2} />
      </button>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  ToolDetailPanel — floating panel to the left of chatbar            */
/* ------------------------------------------------------------------ */

function ToolDetailPanel({
  block,
  rightOffset,
  onClose,
}: {
  block: ToolBlock;
  rightOffset: number | null;
  onClose: () => void;
}) {
  const [inputExpanded, setInputExpanded] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const hasInput = block.input && Object.keys(block.input).length > 0;
  const config = getToolConfig(block.toolName);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Move focus into the dialog so Escape / Tab work from the keyboard.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: clicking the backdrop closes; the keyboard closes with Escape (window keydown above)
    <div
      // Centred mode covers the chat on phones; dim it so the panel reads as on top.
      className={`fixed inset-0 z-[1000] animate-in fade-in-0 duration-150 motion-reduce:animate-none ${rightOffset === null ? "bg-ground/50" : ""}`}
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y/useSemanticElements lint/a11y/useKeyWithClickEvents: panel in a portal overlay positioned beside the chat (a native <dialog> top layer would ignore that placement); its onClick only stops the backdrop's close-on-click */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={config.label}
        className="glass-strong fixed top-1/2 flex max-h-[min(640px,calc(100dvh-32px))] min-h-[240px] -translate-y-1/2 flex-col overflow-hidden rounded-[18px] animate-in fade-in-0 slide-in-from-right-6 zoom-in-97 duration-250 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] motion-reduce:animate-none"
        style={
          rightOffset === null
            ? { left: 8, right: 8 }
            : { right: rightOffset, width: DETAIL_PANEL_WIDTH }
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-4 pt-3.5 pb-3">
          <div className="flex items-center gap-2">
            <ToolIcon type={config.icon} className="size-4 text-fg-soft" />
            <h3 className="font-display text-[17px] leading-none text-fg">
              {config.label}
            </h3>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex size-8 items-center justify-center rounded-[10px] text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
          >
            <XIcon aria-hidden className="size-4" strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          {/* Input -- collapsible */}
          {hasInput && (
            <div>
              <button
                type="button"
                onClick={() => setInputExpanded((v) => !v)}
                className="flex items-center gap-1 rounded-[6px] text-[12px] font-semibold text-fg-soft transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
                aria-expanded={inputExpanded}
              >
                <ChevronRightIcon
                  aria-hidden
                  className={cn(
                    "size-3.5 transition-transform duration-200",
                    inputExpanded && "rotate-90",
                  )}
                  strokeWidth={2}
                />
                输入参数
              </button>
              {inputExpanded && (
                <div className="mt-2 space-y-1.5">
                  {Object.entries(block.input!).map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-[10px] bg-tint/[0.05] px-3 py-2"
                    >
                      <div className="text-[11px] font-medium text-fg-muted">
                        {formatParamName(key)}
                      </div>
                      <div className="mt-0.5 break-all whitespace-pre-wrap text-[12.5px] text-fg">
                        {formatParamValue(value)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Output */}
          {block.output ? (
            <ToolOutputRenderer
              toolName={block.toolName}
              output={block.output}
            />
          ) : block.outputSummary ? (
            <div>
              <div className="mb-2 text-[12px] font-semibold text-fg-soft">
                输出
              </div>
              <div className="rounded-[10px] bg-tint/[0.05] px-3 py-2.5 text-[13.5px] leading-relaxed text-fg whitespace-pre-wrap break-words">
                {block.outputSummary}
              </div>
            </div>
          ) : null}

          {/* Image artifacts */}
          {block.artifacts && block.artifacts.length > 0 && (
            <div>
              <div className="mb-2 text-[12px] font-semibold text-fg-soft">
                附件
              </div>
              <div className="flex flex-wrap gap-2">
                {block.artifacts.map(
                  (artifact: {
                    type: string;
                    url: string;
                    title?: string | undefined;
                  }) =>
                    artifact.type === "image" ? (
                      <ChatImage
                        key={artifact.url}
                        src={artifact.url}
                        alt={artifact.title ?? "生成的图片"}
                        className="max-w-[200px] rounded-[10px] shadow-card"
                      />
                    ) : null,
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tool-specific output renderers                                     */
/* ------------------------------------------------------------------ */

function ToolOutputRenderer({
  toolName,
  output,
}: {
  toolName: string;
  output: Record<string, unknown>;
}) {
  if (toolName === "get_brand_kit" && isBrandKitOutput(output)) {
    return <BrandKitOutput data={output} />;
  }

  const entries = Object.entries(output);
  const isSimple = entries.every(
    ([, v]) =>
      v === null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean",
  );

  if (isSimple && entries.length > 0) {
    return (
      <div>
        <div className="mb-2 text-[12px] font-semibold text-fg-soft">输出</div>
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <div key={key} className="rounded-[10px] bg-tint/[0.05] px-3 py-2">
              <div className="text-[11px] font-medium text-fg-muted">
                {formatParamName(key)}
              </div>
              <div className="mt-0.5 text-[13.5px] text-fg whitespace-pre-wrap break-words">
                {value === null ? "\u2014" : String(value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Complex objects / arrays -- formatted JSON
  return (
    <div>
      <div className="mb-2 text-[12px] font-semibold text-fg-soft">输出</div>
      <div className="max-h-[360px] overflow-auto rounded-[12px] bg-tint/[0.05] px-4 py-3">
        <pre className="font-mono text-[12px] leading-5 text-fg-soft whitespace-pre-wrap break-all">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  BrandKit output renderer                                           */
/* ------------------------------------------------------------------ */

type BrandKitData = {
  kit_name?: string;
  design_guidance?: string;
  colors?: { name?: string; hex?: string; role?: string | null }[];
  fonts?: {
    name?: string;
    family?: string;
    weight?: string;
    role?: string | null;
  }[];
  logos?: { name?: string; url?: string; role?: string | null }[];
  images?: { name?: string; url?: string; role?: string | null }[];
};

function isBrandKitOutput(
  output: Record<string, unknown>,
): output is BrandKitData {
  return (
    "colors" in output ||
    "fonts" in output ||
    "logos" in output ||
    "kit_name" in output
  );
}

function BrandKitOutput({ data }: { data: BrandKitData }) {
  const colors = data.colors?.filter((c) => c.hex) ?? [];
  const fonts = data.fonts?.filter((f) => f.name) ?? [];
  const logos = data.logos?.filter((l) => l.url) ?? [];
  const images = data.images?.filter((i) => i.url) ?? [];

  return (
    <div className="space-y-4">
      {data.kit_name && (
        <div>
          <div className="text-[15px] font-semibold text-fg">
            {data.kit_name}
          </div>
          {data.design_guidance && (
            <div className="mt-0.5 text-[12px] text-fg-soft">
              {data.design_guidance}
            </div>
          )}
        </div>
      )}

      {/* Colors */}
      {colors.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-semibold text-fg-soft">
            颜色
          </div>
          <div className="flex flex-wrap gap-3">
            {colors.map((color, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div
                  className="size-16 rounded-[12px] shadow-[inset_0_0_0_1px_var(--line)]"
                  style={{ backgroundColor: color.hex }}
                />
                <span className="data-label text-fg-muted">{color.hex}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fonts */}
      {fonts.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-semibold text-fg-soft">
            字体
          </div>
          <div className="grid grid-cols-2 gap-2">
            {fonts.map((font, i) => (
              <div key={i} className="rounded-[12px] bg-tint/[0.05] px-3 py-3">
                <div className="mb-1 text-[11px] text-fg-muted">
                  {font.name}
                </div>
                <div
                  className="text-sm text-fg"
                  style={{ fontFamily: font.family }}
                >
                  ABCDEFGHIJKLM
                </div>
                <div
                  className="mt-0.5 text-xs text-fg"
                  style={{ fontFamily: font.family }}
                >
                  abcdefghijklmnopqrstuvwxyz
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Logos & Images */}
      {(logos.length > 0 || images.length > 0) && (
        <div>
          <div className="mb-2 text-[12px] font-semibold text-fg-soft">
            标志和图片
          </div>
          <div className="grid grid-cols-2 gap-2">
            {logos.map((logo, i) => (
              <div
                key={`logo-${i}`}
                className="overflow-hidden rounded-[12px] bg-tint/[0.04]"
              >
                <img
                  src={logo.url}
                  alt={logo.name ?? "Logo"}
                  className="h-auto w-full object-cover"
                  loading="lazy"
                />
                {logo.name && (
                  <div className="truncate px-2 py-1.5 text-[11px] text-fg-muted">
                    {logo.name}
                  </div>
                )}
              </div>
            ))}
            {images.map((img, i) => (
              <div
                key={`img-${i}`}
                className="overflow-hidden rounded-[12px] bg-tint/[0.04]"
              >
                <img
                  src={img.url}
                  alt={img.name ?? "Image"}
                  className="h-auto w-full object-cover"
                  loading="lazy"
                />
                {img.name && (
                  <div className="truncate px-2 py-1.5 text-[11px] text-fg-muted">
                    {img.name}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
