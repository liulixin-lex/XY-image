"use client";

/**
 * The side panels opened from the tool rail: every node on the board
 * (layers, with lock) and the pictures generated on it (with download). They
 * float next to the rail, read the store directly and stay in step with it.
 */
import {
  CircleIcon,
  DiamondIcon,
  DownloadIcon,
  FrameIcon,
  ImageIcon,
  LockIcon,
  type LucideIcon,
  MinusIcon,
  MoveRightIcon,
  SparklesIcon,
  SquareIcon,
  TextQuoteIcon,
  TypeIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, memo, useEffect } from "react";

import { jobIdOf } from "../../lib/node-canvas/element";
import { readGenerator } from "../../lib/node-canvas/generator";
import { imageSourceOf } from "../../lib/node-canvas/render";
import type { SceneElement, SceneNode } from "../../lib/node-canvas/types";
import { cn } from "../../lib/utils";
import { useNodeCanvas, useStoreState } from "./context";

export type CanvasPanel = "layers" | "files";

function snippet(text: unknown, max = 24): string {
  return typeof text === "string"
    ? text.trim().replace(/\s+/g, " ").slice(0, max)
    : "";
}

function titleOf(el: SceneElement): string {
  return snippet(el.customData?.title, 40);
}

/** What a layer row calls a node. */
export function layerLabel(node: SceneNode): string {
  const el = node.data.el;
  switch (node.type) {
    case "generator": {
      const prompt = snippet(readGenerator(el).prompt, 16);
      return prompt ? `生成：${prompt}` : "生成";
    }
    case "prompt":
      return snippet(el.text) || "提示词";
    case "text":
      return snippet(el.text) || "文字";
    case "image":
      return titleOf(el) || "图片";
    case "video":
      return titleOf(el) || "视频";
    case "frame":
      return snippet(el.name) || "画框";
    case "line":
      return el.type === "arrow" ? "箭头" : "线条";
    case "shape": {
      const label = snippet(node.data.label?.text, 16);
      const kind =
        el.type === "ellipse"
          ? "椭圆"
          : el.type === "diamond"
            ? "菱形"
            : "矩形";
      return label ? `${kind}：${label}` : kind;
    }
    default:
      return "元素";
  }
}

function layerIcon(node: SceneNode): LucideIcon {
  const el = node.data.el;
  switch (node.type) {
    case "generator":
      return SparklesIcon;
    case "prompt":
      return TextQuoteIcon;
    case "text":
      return TypeIcon;
    case "video":
      return VideoIcon;
    case "frame":
      return FrameIcon;
    case "line":
      return el.type === "arrow" ? MoveRightIcon : MinusIcon;
    case "shape":
      return el.type === "ellipse"
        ? CircleIcon
        : el.type === "diamond"
          ? DiamondIcon
          : SquareIcon;
    default:
      return ImageIcon;
  }
}

/**
 * Pictures the generator, the assistant or the studio made. Uploads carry a
 * title too (the file name), so they are told apart by their source.
 */
export function isGeneratedPicture(el: SceneElement): boolean {
  if (el.type !== "image") return false;
  if (jobIdOf(el) || el.customData?.source === "generated") return true;
  return el.customData?.source !== "uploaded" && Boolean(titleOf(el));
}

function Thumb({ src, icon: Icon }: { src: string | null; icon: LucideIcon }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-floor text-fg-soft">
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          className="size-full object-cover"
        />
      ) : (
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      )}
    </span>
  );
}

function PanelShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Escape closes the panel before the canvas sees it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <section
      aria-label={title}
      className="glass absolute top-16 left-[72px] z-10 flex w-[min(272px,calc(100%-88px))] flex-col overflow-hidden rounded-xl max-md:bottom-20 md:bottom-[148px]"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-1.5 pl-3.5">
        <h2 className="font-display text-[14px] leading-none text-fg">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={`关闭${title}`}
          className="flex size-7 items-center justify-center rounded-md text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
        >
          <XIcon className="size-4" strokeWidth={1.75} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 [contain:layout_style]">
        {children}
      </div>
    </section>
  );
}

const LayerRow = memo(function LayerRow({
  node,
  src,
  onPick,
}: {
  node: SceneNode;
  src: string | null;
  onPick: (id: string) => void;
}) {
  const { store } = useNodeCanvas();
  const locked = node.data.el.locked === true;
  const label = layerLabel(node);
  // Row and lock are sibling buttons: nested buttons break focus order.
  return (
    <div
      className={cn(
        "group/layer flex h-11 items-center gap-1 rounded-lg pr-1 transition-colors",
        node.selected ? "bg-acc-soft" : "hover:bg-tint/[0.05]",
      )}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 44px" }}
    >
      <button
        type="button"
        onClick={() => onPick(node.id)}
        aria-current={node.selected ? "true" : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-acc"
      >
        <Thumb src={src} icon={layerIcon(node)} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
          {label}
        </span>
      </button>
      <button
        type="button"
        onClick={() => store.setLocked(node.id, !locked)}
        aria-label={locked ? `解锁 ${label}` : `锁定 ${label}`}
        aria-pressed={locked}
        title={locked ? "已锁定，点一下解锁" : "锁定后不能拖动或删除"}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-tint/[0.07] focus-visible:outline-2 focus-visible:outline-acc",
          locked
            ? "text-fg"
            : "invisible text-fg-muted group-hover/layer:visible focus-visible:visible",
        )}
      >
        <LockIcon className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
});

export function LayersPanel({
  onClose,
  onPick,
}: { onClose: () => void; onPick: (id: string) => void }) {
  const nodes = useStoreState((state) => state.scene.nodes);
  const files = useStoreState((state) => state.files);
  // Top of the stack first, like any layers list.
  const rows = nodes.filter((n) => n.type !== "pending").reverse();
  return (
    <PanelShell title="图层" onClose={onClose}>
      {rows.length === 0 ? (
        <p className="px-3 py-10 text-center text-[12.5px] text-fg-muted">
          画布上还没有内容
        </p>
      ) : (
        rows.map((node) => (
          <LayerRow
            key={node.id}
            node={node}
            src={
              node.type === "image" ? imageSourceOf(node.data.el, files) : null
            }
            onPick={onPick}
          />
        ))
      )}
    </PanelShell>
  );
}

export function FilesPanel({
  onClose,
  onPick,
}: { onClose: () => void; onPick: (id: string) => void }) {
  const { actions } = useNodeCanvas();
  const nodes = useStoreState((state) => state.scene.nodes);
  const files = useStoreState((state) => state.files);
  const pictures = nodes
    .filter((n) => n.type === "image" && isGeneratedPicture(n.data.el))
    .reverse();
  return (
    <PanelShell title="生成的图片" onClose={onClose}>
      {pictures.length === 0 ? (
        <p className="px-3 py-10 text-center text-[12.5px] leading-relaxed text-fg-muted">
          这张画布上还没有生成的图片
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {pictures.map((node) => {
            const label = layerLabel(node);
            return (
              <li
                key={node.id}
                className={cn(
                  "flex items-center gap-1 rounded-lg pr-1 transition-colors",
                  node.selected ? "bg-acc-soft" : "hover:bg-tint/[0.05]",
                )}
                style={{
                  contentVisibility: "auto",
                  containIntrinsicSize: "auto 60px",
                }}
              >
                <button
                  type="button"
                  onClick={() => onPick(node.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-acc"
                >
                  <span className="size-12 shrink-0 overflow-hidden rounded-md bg-floor shadow-subtle">
                    {(() => {
                      const src = imageSourceOf(node.data.el, files);
                      return src ? (
                        <img
                          src={src}
                          alt=""
                          loading="lazy"
                          draggable={false}
                          className="size-full object-cover"
                        />
                      ) : null;
                    })()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
                    {label}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => actions.download(node.id)}
                  aria-label={`下载 ${label}`}
                  title="下载"
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
                >
                  <DownloadIcon className="size-4" strokeWidth={1.75} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}
