"use client";

/**
 * A picture on the canvas. Selected alone, it gets a toolbar: use it as a
 * reference for a new generator, download it, delete it. Its right handle
 * feeds generators (reference image), its left one receives a generator's
 * output edge.
 */
import {
  type NodeProps,
  NodeResizer,
  NodeToolbar,
  Position,
} from "@xyflow/react";
import {
  DownloadIcon,
  ImageIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { memo, useState } from "react";

import { imageSourceOf } from "../../lib/node-canvas/render";
import type { SceneNode } from "../../lib/node-canvas/types";
import { cn } from "../../lib/utils";
import { useNodeCanvas, useStoreState } from "./context";
import { NodeHandles } from "./node-parts";

export const RESIZER_PROPS = {
  minWidth: 48,
  minHeight: 48,
  lineClassName: "!border-acc/60",
  handleClassName:
    "!size-2.5 !rounded-[3px] !border-[1.5px] !border-acc !bg-panel",
} as const;

export const ImageNode = memo(function ImageNode({
  id,
  data,
  selected,
}: NodeProps<SceneNode>) {
  const { store, actions } = useNodeCanvas();
  const src = useStoreState((state) => imageSourceOf(data.el, state.files));
  const [failed, setFailed] = useState(false);
  const title =
    typeof data.el.customData?.title === "string"
      ? data.el.customData.title
      : "画布图片";

  return (
    <>
      <NodeResizer isVisible={selected} keepAspectRatio {...RESIZER_PROPS} />
      <NodeToolbar position={Position.Top} offset={12} align="center">
        <div
          role="toolbar"
          aria-label="图片操作"
          className="flex items-center gap-0.5 rounded-lg bg-fg p-1 text-ground shadow-float"
        >
          <button
            type="button"
            onClick={() => actions.generateFrom(id)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-acc px-2.5 text-[13px] font-medium text-acc-ink transition-colors hover:bg-acc-hover focus-visible:outline-2 focus-visible:outline-acc-inverse"
          >
            <WandSparklesIcon
              className="size-4"
              strokeWidth={1.75}
              aria-hidden
            />
            以此为参考
          </button>
          <span className="mx-1 h-4 w-px bg-ground/20" aria-hidden />
          <button
            type="button"
            onClick={() => actions.download(id)}
            title="下载"
            aria-label="下载"
            className="flex size-8 items-center justify-center rounded-md transition-colors hover:bg-ground/15 focus-visible:outline-2 focus-visible:outline-acc-inverse"
          >
            <DownloadIcon className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => store.removeElements([id])}
            title="删除"
            aria-label="删除"
            className="flex size-8 items-center justify-center rounded-md transition-colors hover:bg-ground/15 focus-visible:outline-2 focus-visible:outline-acc-inverse"
          >
            <Trash2Icon className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </NodeToolbar>
      <div
        className={cn(
          "size-full overflow-hidden rounded-frame bg-tint/[0.05] shadow-card transition-shadow duration-150",
          selected && "ring-picked",
        )}
      >
        {src && !failed ? (
          <img
            src={src}
            alt={title}
            draggable={false}
            decoding="async"
            onError={() => {
              console.warn(`[node-canvas] picture ${id} did not load`);
              setFailed(true);
            }}
            className="size-full select-none object-cover"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 p-3 text-center text-fg-muted">
            <ImageIcon className="size-5" strokeWidth={1.5} aria-hidden />
            <span className="text-[12px]">
              {failed ? "图片没有加载出来" : "图片还在路上"}
            </span>
          </div>
        )}
      </div>
      <NodeHandles />
    </>
  );
});
