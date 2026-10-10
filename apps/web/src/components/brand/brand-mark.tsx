import type { SVGProps } from "react";

import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Coral in each theme (globals.css --acc); used when CSS variables are absent. */
const CORAL = "#e5533d";

/**
 * GGUU mark: a coral tile cut on the poster slant (the same -14° lean as
 * the slanted buttons), softly rounded. It reads at 16px as "coral slash".
 * Takes the theme's accent (--acc) unless `fixed` is set, for contexts
 * without the CSS variables (static assets, emails).
 */
export function BrandMark({
  title = BRAND.name,
  fixed = false,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string; fixed?: boolean }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
      {...props}
    >
      <rect
        x="6"
        y="5"
        width="22"
        height="22"
        rx="5.5"
        transform="translate(3.5 0) skewX(-14)"
        style={{ fill: fixed ? CORAL : `var(--acc, ${CORAL})` }}
      />
    </svg>
  );
}

/** Mark + wordmark: GGUU in the display face, then a slanted AI IMAGE tag. */
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
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark className={cn("size-7 drop-shadow-[0_6px_10px_var(--acc-glow)]", markClassName)} title="" />
      <span className="font-display text-[25px] leading-none tracking-[0.02em] text-fg">
        {BRAND.short}
      </span>
      {compact ? null : (
        <span
          className={cn(
            "sk ml-1 rounded-[5px] bg-tint/[0.06] px-[7px] py-[5px] text-[9.5px] leading-none font-semibold tracking-[0.14em] text-fg-soft",
            tagClassName,
          )}
        >
          <span className="sk-in">{BRAND.tag}</span>
        </span>
      )}
    </span>
  );
}
