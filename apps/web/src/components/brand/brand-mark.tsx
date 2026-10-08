import { type SVGProps, useId } from "react";

import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * GGUU mark: a light hanging over a horizon, with its reflection on the
 * floor. It is the 氛围屏 room in miniature. The orb takes the room's
 * ambient colour (--amb / --amb-2), so the mark re-lights with the page;
 * pass `fixed` for contexts without the CSS variables (static assets).
 * Reads at 16px as "dark tile, glowing dot".
 */
export function BrandMark({
  title = BRAND.name,
  fixed = false,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string; fixed?: boolean }) {
  const id = useId().replace(/:/g, "");
  const amb = fixed ? "rgb(72 214 204)" : "rgb(var(--amb, 72 214 204))";
  const amb2 = fixed ? "rgb(70 120 255)" : "rgb(var(--amb-2, 70 120 255))";
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d2744" />
          <stop offset="1" stopColor="#090e1c" />
        </linearGradient>
        <radialGradient id={`${id}-orb`} cx="0.38" cy="0.36" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" style={{ stopColor: amb }} />
          <stop offset="1" style={{ stopColor: amb2 }} />
        </radialGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" style={{ stopColor: amb, stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: amb, stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <rect width="32" height="32" rx="8.5" fill={`url(#${id}-tile)`} />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="8"
        fill="none"
        stroke="rgb(255 255 255 / 0.16)"
      />
      <circle cx="16" cy="14" r="10" fill={`url(#${id}-glow)`} />
      <line x1="7" y1="21" x2="25" y2="21" stroke="rgb(255 255 255 / 0.2)" strokeWidth="0.8" />
      <ellipse cx="16" cy="24" rx="4.4" ry="1.4" style={{ fill: amb }} opacity="0.4" />
      <circle cx="16" cy="14" r="5.2" fill={`url(#${id}-orb)`} />
    </svg>
  );
}

/** Mark + wordmark: GGUU in bold, then an outlined AI IMAGE tag. */
export function BrandLockup({
  className,
  markClassName,
  tagClassName,
  compact = false,
}: {
  className?: string;
  markClassName?: string;
  /** Extra classes for the AI IMAGE tag, e.g. to hide it at some widths. */
  tagClassName?: string;
  /** Hide the AI IMAGE tag where space is tight. */
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark className={cn("size-7", markClassName)} title="" />
      <span className="text-[17px] leading-none font-bold tracking-[-0.01em] text-fg">
        {BRAND.short}
      </span>
      {compact ? null : (
        <span
          className={cn(
            "-ml-0.5 rounded-sm border border-line-strong px-1.5 py-[3px] text-[10.5px] leading-none font-semibold tracking-[0.16em] text-fg-soft",
            tagClassName,
          )}
        >
          {BRAND.tag}
        </span>
      )}
    </span>
  );
}
