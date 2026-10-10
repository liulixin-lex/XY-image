"use client";

/** Shared pieces of the node canvas nodes: handles, the card, colours. */
import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

/** Inputs come in on the left, outputs leave on the right. */
export function NodeHandles({
  target = true,
  source = true,
}: { target?: boolean; source?: boolean }) {
  const handle =
    "!size-3 !rounded-full !border-[1.5px] !border-acc !bg-panel transition-transform hover:!scale-125";
  return (
    <>
      {target ? (
        <Handle
          type="target"
          position={Position.Left}
          className={handle}
          aria-label="连入"
        />
      ) : null}
      {source ? (
        <Handle
          type="source"
          position={Position.Right}
          className={handle}
          aria-label="连出"
        />
      ) : null}
    </>
  );
}

/** A card node: header with icon and title, then its body. */
export function CardNode({
  icon,
  title,
  aside,
  selected,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
  selected?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-full flex-col rounded-xl border bg-panel text-fg shadow-card transition-[border-color,box-shadow] duration-150",
        selected ? "border-acc shadow-card-hover" : "border-line",
        className,
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 px-3.5">
        <span
          className="flex size-4 items-center justify-center text-acc-text"
          aria-hidden
        >
          {icon}
        </span>
        <span className="font-display text-[14px] leading-none text-fg">
          {title}
        </span>
        {aside ? (
          <div className="ml-auto flex min-w-0 items-center">{aside}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Stroke colours meaning "default ink" follow the theme's text colour. */
const DEFAULT_INKS = new Set(["#1e1e1e", "#000000", "#000"]);

export function inkColor(color: unknown): string {
  if (
    typeof color !== "string" ||
    !color ||
    DEFAULT_INKS.has(color.toLowerCase())
  )
    return "var(--fg)";
  return color;
}

export function fillColor(color: unknown): string {
  return typeof color === "string" && color && color !== "transparent"
    ? color
    : "none";
}

/** Relative luminance of a #rgb / #rrggbb colour, null for anything else. */
function luminance(color: string): number | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Ink for a label inside a filled shape. Default ink follows the theme, which
 * is unreadable on a pale fill in dark mode, so it follows the fill instead.
 */
export function labelInk(color: unknown, fill: unknown): string {
  const ink = inkColor(color);
  if (ink !== "var(--fg)" || typeof fill !== "string") return ink;
  const lum = luminance(fill);
  if (lum === null) return ink;
  return lum > 0.4 ? "#1e1e1e" : "#f4f4f5";
}
