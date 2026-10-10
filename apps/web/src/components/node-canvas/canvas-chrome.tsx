"use client";

/**
 * The node canvas's own controls: the tool rail on the left and the zoom
 * bar under the minimap. Both float over the board in the room's panel
 * material.
 */
import { useReactFlow, useViewport } from "@xyflow/react";
import {
  FilesIcon,
  FrameIcon,
  HandIcon,
  ImagePlusIcon,
  LayersIcon,
  MaximizeIcon,
  MinusIcon,
  MousePointer2Icon,
  PlusIcon,
  Redo2Icon,
  SparklesIcon,
  TextQuoteIcon,
  TypeIcon,
  Undo2Icon,
} from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "../../lib/utils";
import { useStoreState } from "./context";

export type CanvasTool = "select" | "hand";

export type CreateKind = "prompt" | "generator" | "image" | "text" | "frame";

type IconType = ComponentType<{ className?: string; strokeWidth?: number }>;

function RailButton({
  icon: Icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
}: {
  icon: IconType;
  label: string;
  shortcut?: string;
  active?: boolean | undefined;
  disabled?: boolean;
  onClick: () => void;
}) {
  const title = shortcut ? `${label}（${shortcut}）` : label;
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-9 items-center justify-center rounded-lg transition-colors outline-none focus-visible:outline-2 focus-visible:outline-acc disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-fg text-ground"
          : "text-fg-soft hover:bg-tint/[0.07] hover:text-fg",
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </button>
  );
}

function Divider() {
  return <span className="mx-auto my-1 h-px w-5 bg-line" aria-hidden />;
}

export function ToolRail({
  tool,
  onTool,
  onCreate,
  onUndo,
  onRedo,
  layersOpen,
  filesOpen,
  onToggleLayers,
  onToggleFiles,
}: {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  onCreate: (kind: CreateKind) => void;
  onUndo: () => void;
  onRedo: () => void;
  layersOpen?: boolean | undefined;
  filesOpen?: boolean | undefined;
  onToggleLayers?: (() => void) | undefined;
  onToggleFiles?: (() => void) | undefined;
}) {
  const canUndo = useStoreState((state) => state.canUndo);
  const canRedo = useStoreState((state) => state.canRedo);
  return (
    <div
      role="toolbar"
      aria-label="画布工具"
      aria-orientation="vertical"
      className="glass flex w-12 flex-col gap-0.5 rounded-xl p-1.5"
    >
      <RailButton
        icon={MousePointer2Icon}
        label="选择"
        shortcut="V"
        active={tool === "select"}
        onClick={() => onTool("select")}
      />
      <RailButton
        icon={HandIcon}
        label="拖动画布"
        shortcut="H"
        active={tool === "hand"}
        onClick={() => onTool("hand")}
      />
      <Divider />
      <RailButton
        icon={TextQuoteIcon}
        label="提示词卡片"
        shortcut="P"
        onClick={() => onCreate("prompt")}
      />
      <RailButton
        icon={SparklesIcon}
        label="生成节点"
        shortcut="G"
        onClick={() => onCreate("generator")}
      />
      <RailButton
        icon={ImagePlusIcon}
        label="上传图片"
        shortcut="U"
        onClick={() => onCreate("image")}
      />
      <RailButton
        icon={TypeIcon}
        label="文字"
        shortcut="T"
        onClick={() => onCreate("text")}
      />
      <RailButton
        icon={FrameIcon}
        label="画框"
        shortcut="F"
        onClick={() => onCreate("frame")}
      />
      <Divider />
      <RailButton
        icon={Undo2Icon}
        label="撤销"
        shortcut="⌘Z"
        disabled={!canUndo}
        onClick={onUndo}
      />
      <RailButton
        icon={Redo2Icon}
        label="重做"
        shortcut="⇧⌘Z"
        disabled={!canRedo}
        onClick={onRedo}
      />
      {onToggleLayers || onToggleFiles ? <Divider /> : null}
      {onToggleLayers ? (
        <RailButton
          icon={LayersIcon}
          label="图层"
          active={layersOpen}
          onClick={onToggleLayers}
        />
      ) : null}
      {onToggleFiles ? (
        <RailButton
          icon={FilesIcon}
          label="画布里的图片"
          active={filesOpen}
          onClick={onToggleFiles}
        />
      ) : null}
    </div>
  );
}

const ZOOM_STEPS = { min: 0.1, max: 4 };

export function ZoomBar() {
  const { zoomIn, zoomOut, fitView, zoomTo } = useReactFlow();
  const { zoom } = useViewport();
  const percent = Math.round(zoom * 100);
  const button =
    "flex size-8 items-center justify-center rounded-md text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc disabled:opacity-40";
  return (
    <fieldset
      aria-label="缩放"
      className="glass flex h-10 items-center gap-0.5 rounded-xl px-1"
    >
      <button
        type="button"
        className={button}
        onClick={() => zoomOut({ duration: 180 })}
        disabled={zoom <= ZOOM_STEPS.min + 1e-3}
        aria-label="缩小"
        title="缩小"
      >
        <MinusIcon className="size-4" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => zoomTo(1, { duration: 180 })}
        title="缩放到 100%"
        className="h-8 min-w-12 rounded-md px-1 text-[12.5px] text-fg tabular transition-colors hover:bg-tint/[0.07] focus-visible:outline-2 focus-visible:outline-acc"
      >
        {percent}%
      </button>
      <button
        type="button"
        className={button}
        onClick={() => zoomIn({ duration: 180 })}
        disabled={zoom >= ZOOM_STEPS.max - 1e-3}
        aria-label="放大"
        title="放大"
      >
        <PlusIcon className="size-4" strokeWidth={1.75} />
      </button>
      <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
      <button
        type="button"
        className={button}
        onClick={() => fitView({ padding: 0.2, maxZoom: 1, duration: 240 })}
        aria-label="显示全部内容"
        title="显示全部内容（⇧1）"
      >
        <MaximizeIcon className="size-4" strokeWidth={1.75} />
      </button>
    </fieldset>
  );
}

export const ZOOM_LIMITS = ZOOM_STEPS;
