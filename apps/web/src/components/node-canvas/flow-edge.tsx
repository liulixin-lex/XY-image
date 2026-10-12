"use client";

/**
 * An edge of the node canvas: a soft curve from an output to an input. A
 * label (text bound to the arrow) sits on its middle.
 *
 * 断开 (第 56 条): edges could only be removed by selecting one and pressing
 * Delete, which nobody found and touch screens can't do. Now a hovered or
 * selected edge shows a 断开 button on its middle; its ends can also be
 * dragged to another node (reconnect) or off onto empty canvas (断开), see
 * NodeCanvasStore.onReconnect / endReconnect.
 */
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import { UnlinkIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import type { SceneEdge } from "../../lib/node-canvas/types";
import { cn } from "../../lib/utils";
import { useNodeCanvas } from "./context";

/** How long the button stays after the pointer leaves the edge (to reach it). */
const HIDE_DELAY_MS = 220;

export const FlowEdge = memo(function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  deletable,
}: EdgeProps<SceneEdge>) {
  const { store } = useNodeCanvas();
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const label = typeof data?.label?.text === "string" ? data.label.text : null;
  // View-only links (pictures on their way) have no element and no button.
  const removable = deletable !== false && Boolean(data?.el);

  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enter = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setHovered(true);
  }, []);
  const leave = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHovered(false), HIDE_DELAY_MS);
  }, []);
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );
  const showButton = removable && (hovered || Boolean(selected));
  const active = hovered || Boolean(selected);

  return (
    <>
      <g onPointerEnter={enter} onPointerLeave={leave}>
        <BaseEdge
          id={id}
          path={path}
          interactionWidth={22}
          className={cn(
            "transition-[stroke,stroke-width,opacity] duration-150",
            active && "!stroke-[2.25px]",
            hovered && !selected && "flow-edge-hover",
          )}
        />
      </g>
      {label || showButton ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute flex flex-col items-center gap-1.5"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            onPointerEnter={enter}
            onPointerLeave={leave}
          >
            {label ? (
              <div className="rounded-md bg-panel px-1.5 py-0.5 text-[12px] text-fg-soft shadow-subtle">
                {label}
              </div>
            ) : null}
            {showButton ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  store.disconnect(id);
                }}
                title="断开这条连线（也可以把线的一端拖到空白处）"
                aria-label="断开连线"
                className="glass-float flex h-7 animate-in items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-fg-soft fade-in-0 zoom-in-90 duration-150 hover:text-alert focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:scale-95"
              >
                <UnlinkIcon className="size-3.5" strokeWidth={2} />
                断开
              </button>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});
