"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { useDragScroll } from "@/hooks/use-drag-scroll";
import { cn } from "@/lib/utils";

import type { ShowcaseItem } from "./showcase";

/**
 * Sample strip on the hero's floor: every sample as a slanted thumbnail;
 * pick one and the poster and the room take it.
 *
 * The row is wider than its column, so it scrolls sideways: swipe or use a
 * trackpad, drag or wheel with a mouse, the edge arrows, or ←/→ on the
 * keyboard (a radio group: one tab stop, arrows move the choice). Whatever
 * selects a sample (the gallery below re-lights the room on hover too)
 * brings its thumbnail into view, moving the row only, never the page.
 */
export function SampleStrip({
  items,
  selected,
  onSelect,
  className,
}: {
  items: ShowcaseItem[];
  selected: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  useDragScroll(rail, { wheel: true });

  // Which ends still have more to show: drives the edge fades and arrows.
  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { start: el.scrollLeft <= 1, end: el.scrollLeft >= max - 1 };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    resize?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      resize?.disconnect();
    };
  }, [measure]);

  // Keep the chosen thumbnail in view. Scrolls the rail itself:
  // scrollIntoView would also move the page when the hero is off screen.
  useEffect(() => {
    const el = rail.current;
    const thumb = el?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    // Not laid out yet (hidden, or no layout engine): nothing to reveal.
    if (!el || !thumb || el.clientWidth === 0) return;
    const pad = 28;
    const left = thumb.offsetLeft - pad;
    const right = thumb.offsetLeft + thumb.offsetWidth + pad - el.clientWidth;
    const target = el.scrollLeft > left ? left : el.scrollLeft < right ? right : null;
    if (target === null) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: target, behavior: smooth ? "smooth" : "auto" });
  }, [selected]);

  const page = (direction: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.75, behavior: smooth ? "smooth" : "auto" });
  };

  // Radio group keys: arrows move the choice (and focus) and wrap; Home/End jump.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = items.length - 1;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? selected >= last ? 0 : selected + 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? selected <= 0 ? last : selected - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    rail.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus({ preventScroll: true });
  };

  return (
    <div className={cn("group/strip relative min-w-0 flex-1", className)}>
      <div
        ref={rail}
        role="radiogroup"
        aria-label="换一张示例作品"
        onKeyDown={onKeyDown}
        data-start={edges.start || undefined}
        data-end={edges.end || undefined}
        className={cn(
          "-my-2 flex cursor-grab items-end gap-2.5 overflow-x-auto overscroll-x-contain px-2 py-2 scrollbar-hidden select-none data-[dragging=true]:cursor-grabbing",
          // Fade whichever edge still has thumbnails beyond it.
          "[--fade-l:28px] [--fade-r:28px] data-[start]:[--fade-l:0px] data-[end]:[--fade-r:0px]",
          "[mask-image:linear-gradient(90deg,transparent,#000_var(--fade-l),#000_calc(100%-var(--fade-r)),transparent)]",
        )}
      >
        {items.map((entry, index) => {
          const active = index === selected;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              data-index={index}
              aria-checked={active}
              aria-label={`换成示例：${entry.prompt}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(index)}
              className={cn(
                "group sk shrink-0 rounded-[14px] transition-[width,height,box-shadow] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-acc",
                active
                  ? "ring-picked h-[clamp(96px,12dvh,120px)] w-[clamp(77px,9.6dvh,96px)]"
                  : "h-[clamp(78px,9.6dvh,96px)] w-[clamp(62px,7.8dvh,78px)] shadow-[0_10px_20px_-12px_var(--shadow-2)]",
              )}
            >
              <span className="block h-full w-full overflow-hidden rounded-[14px]">
                {/* biome-ignore lint/performance/noImgElement: static export */}
                <img
                  src={entry.src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="h-full w-[124%] max-w-none -translate-x-[10%] skew-x-[10deg] object-cover transition-[filter] duration-300 group-hover:brightness-105"
                  style={{ objectPosition: entry.focus }}
                />
              </span>
            </button>
          );
        })}
      </div>
      {/* Edge arrows for a mouse (touch swipes), shown only toward more. */}
      <StripArrow direction={-1} hidden={edges.start} onClick={() => page(-1)} />
      <StripArrow direction={1} hidden={edges.end} onClick={() => page(1)} />
    </div>
  );
}

function StripArrow({ direction, hidden, onClick }: { direction: 1 | -1; hidden: boolean; onClick: () => void }) {
  const Icon = direction < 0 ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={direction < 0 ? "往前看示例" : "往后看示例"}
      onClick={onClick}
      className={cn(
        "glass-float sk absolute top-1/2 z-[1] flex size-8 -translate-y-1/2 items-center justify-center rounded-[10px] text-fg transition-[opacity,background-color,scale] duration-200 hover:bg-tint/[0.08] active:scale-95 pointer-coarse:hidden",
        direction < 0 ? "-left-1" : "-right-1",
        hidden ? "pointer-events-none opacity-0" : "opacity-100",
      )}
    >
      <Icon className="sk-in size-4" strokeWidth={2.2} />
    </button>
  );
}
