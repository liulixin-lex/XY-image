"use client";

/**
 * An edge of the node canvas: a soft curve from an output to an input. A
 * label (text bound to the arrow) sits on its middle.
 */
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import { memo } from "react";

import type { SceneEdge } from "../../lib/node-canvas/types";
import { cn } from "../../lib/utils";

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
}: EdgeProps<SceneEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const label = typeof data?.label?.text === "string" ? data.label.text : null;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        className={cn(
          "transition-[stroke,stroke-width] duration-150",
          selected && "!stroke-[2.25px]",
        )}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute rounded-md bg-panel px-1.5 py-0.5 text-[12px] text-fg-soft shadow-subtle"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});
