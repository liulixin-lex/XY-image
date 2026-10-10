"use client";

import { aspectRatioValue } from "@loomic/shared";

import { ASPECT_RATIOS } from "@/lib/image-model-meta";
import { cn } from "@/lib/utils";

/**
 * Columns pair each portrait shape with its landscape twin (4:5 over 5:4,
 * 9:16 over 16:9); the first column holds the square and the widest.
 */
const GRID_ORDER = [
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
  "21:9",
  "5:4",
  "4:3",
  "3:2",
  "16:9",
];

/**
 * 比例 as a 5×2 grid of chips, each with a small frame drawn in its shape.
 * Ratios the model cannot make stay visible but disabled, with the reason
 * in their title. Radio-group semantics with arrow-key movement.
 */
export function RatioGrid({
  value,
  onValueChange,
  supported,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  supported: readonly string[];
  className?: string;
}) {
  const ratios = [
    ...GRID_ORDER.filter((r) =>
      (ASPECT_RATIOS as readonly string[]).includes(r),
    ),
    // A model may list a ratio the grid does not place; keep it reachable.
    ...supported.filter((r) => !GRID_ORDER.includes(r)),
  ];
  const enabled = (ratio: string) => supported.includes(ratio);
  const move = (from: number, step: number) => {
    for (let i = 1; i <= ratios.length; i += 1) {
      const next =
        ratios[(from + step * i + ratios.length * i) % ratios.length];
      if (next && enabled(next)) return next;
    }
    return null;
  };
  return (
    <div
      role="radiogroup"
      aria-label="画面比例"
      className={cn("grid grid-cols-5 gap-1.5", className)}
    >
      {ratios.map((ratio, index) => {
        const active = ratio === value;
        const disabled = !enabled(ratio);
        return (
          <button
            key={ratio}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${ratio}${disabled ? "，当前模型不支持" : ""}`}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            title={disabled ? `当前模型不支持 ${ratio}` : undefined}
            onClick={() => onValueChange(ratio)}
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step) return;
              event.preventDefault();
              const next = move(index, step);
              if (next === null) return;
              onValueChange(next);
              const group = event.currentTarget.parentElement;
              requestAnimationFrame(() =>
                group
                  ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
                  ?.focus(),
              );
            }}
            className={cn(
              "flex h-[46px] flex-col items-center justify-center gap-1 rounded-[10px] text-[12px] font-semibold tabular outline-none transition-[background-color,color,scale] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35",
              active
                ? "bg-fg text-ground"
                : "bg-tint/[0.055] text-fg-soft hover:bg-tint/[0.09] hover:text-fg",
            )}
          >
            <RatioFrame ratio={ratio} />
            <span className="leading-none">{ratio}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The ratio drawn as a frame inside a 16px box. */
function RatioFrame({ ratio }: { ratio: string }) {
  const value = aspectRatioValue(ratio) ?? 1;
  const width = value >= 1 ? 16 : Math.max(5, 16 * value);
  const height = value >= 1 ? Math.max(5, 16 / value) : 16;
  return (
    <span aria-hidden className="flex size-4 items-center justify-center">
      <span
        className="rounded-[2px] border-[1.5px] border-current opacity-80"
        style={{ width, height }}
      />
    </span>
  );
}
