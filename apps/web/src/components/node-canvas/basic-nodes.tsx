"use client";

/**
 * Nodes for what canvases held before the node canvas, and what the design
 * assistant still draws: free text, shapes with labels, lines and arrows,
 * frames and videos. They look like the board they came from and keep every
 * field they were loaded with.
 */
import { type NodeProps, NodeResizer } from "@xyflow/react";
import { memo, useEffect, useRef, useState } from "react";

import { bumpElement, readNumber } from "../../lib/node-canvas/element";
import type { SceneElement, SceneNode } from "../../lib/node-canvas/types";
import { cn } from "../../lib/utils";
import { useNodeCanvas } from "./context";
import { RESIZER_PROPS } from "./image-node";
import { NodeHandles, fillColor, inkColor, labelInk } from "./node-parts";

const FONT_STACK = 'var(--font-noto-sc), "PingFang SC", system-ui, sans-serif';

/** New text nodes open in edit mode once. */
const editOnMount = new Set<string>();
export function requestTextEdit(id: string) {
  editOnMount.add(id);
}

function textStyle(el: SceneElement): React.CSSProperties {
  const fontSize = readNumber(el.fontSize, 20);
  return {
    fontSize,
    lineHeight: readNumber(el.lineHeight, 1.25),
    color: inkColor(el.strokeColor),
    fontFamily: FONT_STACK,
    textAlign:
      el.textAlign === "center" || el.textAlign === "right"
        ? el.textAlign
        : "left",
  };
}

export const TextNode = memo(function TextNode({
  id,
  data,
  selected,
}: NodeProps<SceneNode>) {
  const { store } = useNodeCanvas();
  const stored = typeof data.el.text === "string" ? data.el.text : "";
  const [editing, setEditing] = useState(() => editOnMount.has(id));
  const [text, setText] = useState(stored);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setText(stored);
  }, [stored, editing]);

  useEffect(() => {
    if (!editing) return;
    editOnMount.delete(id);
    store.beginEdit();
    const el = area.current;
    el?.focus();
    el?.select();
  }, [editing, store, id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text or mode changes
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.style.width = "auto";
    el.style.width = `${Math.max(40, el.scrollWidth + 4)}px`;
  }, [text, editing]);

  const finish = () => {
    setEditing(false);
    store.endEdit();
    // Like any whiteboard: text left empty goes away.
    if (!text.trim()) store.removeElements([id]);
  };

  const style = textStyle(data.el);
  return (
    <div
      className={cn(
        "rounded-sm px-0.5",
        selected && !editing && "outline outline-1 outline-acc/70",
      )}
      onDoubleClick={() => setEditing(true)}
    >
      {editing ? (
        <textarea
          ref={area}
          value={text}
          aria-label="文字"
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            store.updateElement(
              id,
              (el) => bumpElement(el, { text: next, originalText: next }),
              {
                record: false,
              },
            );
          }}
          onBlur={finish}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") area.current?.blur();
          }}
          rows={1}
          style={style}
          className="nodrag nowheel block resize-none overflow-hidden whitespace-pre bg-transparent outline-none"
        />
      ) : (
        <div style={style} className="whitespace-pre select-none">
          {stored || " "}
        </div>
      )}
      <NodeHandles />
    </div>
  );
});

export const ShapeNode = memo(function ShapeNode({
  data,
  selected,
  width,
  height,
}: NodeProps<SceneNode>) {
  const el = data.el;
  const w = width ?? el.width;
  const h = height ?? el.height;
  const stroke = inkColor(el.strokeColor);
  const strokeWidth = Math.max(1, readNumber(el.strokeWidth, 1));
  const dash =
    el.strokeStyle === "dashed"
      ? `${strokeWidth * 4} ${strokeWidth * 3}`
      : el.strokeStyle === "dotted"
        ? `${strokeWidth} ${strokeWidth * 2.5}`
        : undefined;
  const inset = strokeWidth / 2;
  const shared = {
    fill: fillColor(el.backgroundColor),
    stroke,
    strokeWidth,
    strokeDasharray: dash,
    vectorEffect: "non-scaling-stroke" as const,
  };
  const label = data.label;
  return (
    <>
      <NodeResizer
        isVisible={selected}
        {...RESIZER_PROPS}
        minWidth={16}
        minHeight={16}
      />
      <svg
        width={w}
        height={h}
        className="absolute inset-0 overflow-visible"
        aria-hidden="true"
      >
        {el.type === "ellipse" ? (
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={Math.max(0, w / 2 - inset)}
            ry={Math.max(0, h / 2 - inset)}
            {...shared}
          />
        ) : el.type === "diamond" ? (
          <polygon
            points={`${w / 2},${inset} ${w - inset},${h / 2} ${w / 2},${h - inset} ${inset},${h / 2}`}
            {...shared}
          />
        ) : (
          <rect
            x={inset}
            y={inset}
            width={Math.max(0, w - strokeWidth)}
            height={Math.max(0, h - strokeWidth)}
            rx={el.roundness ? Math.min(16, w / 4, h / 4) : 0}
            {...shared}
          />
        )}
      </svg>
      {label && typeof label.text === "string" ? (
        <div className="absolute inset-0 flex items-center justify-center p-2">
          <div
            style={{
              ...textStyle(label),
              color: labelInk(label.strokeColor, el.backgroundColor),
            }}
            className="whitespace-pre"
          >
            {label.text}
          </div>
        </div>
      ) : null}
      <NodeHandles />
    </>
  );
});

type Point = [number, number];

function pointsOf(el: SceneElement): Point[] {
  return Array.isArray(el.points)
    ? (el.points as unknown[]).flatMap((p): Point[] =>
        Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
          ? [[p[0], p[1]]]
          : [],
      )
    : [];
}

function arrowhead(from: Point, to: Point, size: number): string {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const a = angle - Math.PI / 7;
  const b = angle + Math.PI / 7;
  return `M ${to[0] - size * Math.cos(a)} ${to[1] - size * Math.sin(a)} L ${to[0]} ${to[1]} L ${to[0] - size * Math.cos(b)} ${to[1] - size * Math.sin(b)}`;
}

export const LineNode = memo(function LineNode({
  data,
  selected,
  width,
  height,
}: NodeProps<SceneNode>) {
  const el = data.el;
  const offset = data.offset ?? { x: 0, y: 0 };
  const points = pointsOf(el).map(
    ([x, y]): Point => [x + offset.x, y + offset.y],
  );
  const strokeWidth = Math.max(1, readNumber(el.strokeWidth, 2));
  const stroke = inkColor(el.strokeColor);
  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
  const last = points.at(-1);
  const beforeLast = points.at(-2);
  const first = points[0];
  const second = points[1];
  const head = 10 + strokeWidth * 2;
  return (
    <svg
      width={width ?? 1}
      height={height ?? 1}
      className={cn(
        "overflow-visible",
        selected && "drop-shadow-[0_0_2px_var(--acc)]",
      )}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* A wide clear stroke makes thin lines easy to grab. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(12, strokeWidth + 8)}
      />
      {el.endArrowhead && last && beforeLast ? (
        <path
          d={arrowhead(beforeLast, last, head)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      ) : null}
      {el.startArrowhead && first && second ? (
        <path
          d={arrowhead(second, first, head)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
});

export const FrameNode = memo(function FrameNode({
  data,
  selected,
}: NodeProps<SceneNode>) {
  const name =
    typeof data.el.name === "string" && data.el.name ? data.el.name : "画框";
  return (
    <>
      <NodeResizer
        isVisible={selected}
        {...RESIZER_PROPS}
        minWidth={80}
        minHeight={60}
      />
      <div
        className={cn(
          "size-full rounded-xl border-[1.5px] border-dashed bg-tint/[0.025]",
          selected ? "border-acc" : "border-line-strong",
        )}
      />
      <span className="absolute -top-6 left-0 max-w-full truncate text-[12.5px] text-fg-soft">
        {name}
      </span>
    </>
  );
});

export const VideoNode = memo(function VideoNode({
  data,
  selected,
}: NodeProps<SceneNode>) {
  const link = typeof data.el.link === "string" ? data.el.link : null;
  const title =
    typeof data.el.customData?.title === "string"
      ? data.el.customData.title
      : "视频";
  return (
    <>
      <NodeResizer isVisible={selected} keepAspectRatio {...RESIZER_PROPS} />
      <div
        className={cn(
          "size-full overflow-hidden rounded-frame bg-floor shadow-card",
          selected && "ring-picked",
        )}
      >
        {link ? (
          // biome-ignore lint/a11y/useMediaCaption: generated clips have no captions
          <video
            src={link}
            controls
            playsInline
            preload="metadata"
            aria-label={title}
            className="nodrag size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-[12px] text-fg-muted">
            视频不可用
          </div>
        )}
      </div>
      <NodeHandles />
    </>
  );
});
