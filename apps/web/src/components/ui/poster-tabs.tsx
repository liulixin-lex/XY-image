"use client";

import { useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Page-level tabs in the poster vocabulary: slanted tabs, the open one
 * inked, the way the top navigation marks the current page. Tab semantics
 * with a roving tab stop; ←/→ move and open, Home/End jump to the ends.
 * Pair each tab with a panel: `id={`${idPrefix}-panel-${value}`}` and
 * `aria-labelledby={`${idPrefix}-tab-${value}`}` (see `posterPanelProps`).
 */
export function PosterTabs<T extends string>({
  value,
  onValueChange,
  tabs,
  ariaLabel,
  idPrefix,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  tabs: ReadonlyArray<{ value: T; label: string }>;
  ariaLabel: string;
  idPrefix: string;
  className?: string;
}) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  const move = (to: number) => {
    const next = tabs[(to + tabs.length) % tabs.length];
    if (!next) return;
    onValueChange(next.value);
    refs.current[next.value]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "-mx-1 flex max-w-full items-center gap-1.5 overflow-x-auto px-1 py-1 scrollbar-hidden",
        className,
      )}
      onKeyDown={(e) => {
        const index = tabs.findIndex((t) => t.value === value);
        if (e.key === "ArrowRight") move(index + 1);
        else if (e.key === "ArrowLeft") move(index - 1);
        else if (e.key === "Home") move(0);
        else if (e.key === "End") move(tabs.length - 1);
        else return;
        e.preventDefault();
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[tab.value] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.value}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.value}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(tab.value)}
            className={cn(
              "sk h-10 shrink-0 rounded-[11px] px-4 text-[14px] font-semibold whitespace-nowrap transition-[background-color,color,translate] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:translate-y-px",
              selected
                ? "bg-fg text-ground"
                : "bg-tint/[0.055] text-fg-soft hover:bg-tint/[0.09] hover:text-fg",
            )}
          >
            <span className="sk-in">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Props for the panel that belongs to the open tab. */
export function posterPanelProps(idPrefix: string, value: string) {
  return {
    role: "tabpanel" as const,
    id: `${idPrefix}-panel-${value}`,
    "aria-labelledby": `${idPrefix}-tab-${value}`,
  };
}
