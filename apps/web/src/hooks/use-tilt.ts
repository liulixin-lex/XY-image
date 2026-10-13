"use client";

import { type RefObject, useEffect } from "react";

/**
 * Cards that lean toward the pointer (第 62 条, workspace home). One
 * delegated listener on `container`; the card under the pointer (closest
 * `[data-tilt]`) gets `--rx` / `--ry` CSS variables, which the `tilt`
 * utility turns into a small perspective rotation. Only for a fine pointer
 * that can hover, and never under reduced motion. rAF-throttled; writes CSS
 * variables only, no layout reads beyond the card's own rect.
 */
/** `ready`: pass false while the container is not rendered yet (data loading). */
export function useTilt(
  container: RefObject<HTMLElement | null>,
  { max = 6, ready = true }: { max?: number; ready?: boolean } = {},
) {
  useEffect(() => {
    const root = container.current;
    if (!root || !ready) return;
    const ok = window.matchMedia(
      "(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)",
    );
    if (!ok.matches) return;
    let frame = 0;
    let current: HTMLElement | null = null;
    const reset = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.removeProperty("--rx");
      el.style.removeProperty("--ry");
      delete el.dataset.tilting;
    };
    const move = (event: PointerEvent) => {
      const target =
        (event.target as HTMLElement | null)?.closest<HTMLElement>(
          "[data-tilt]",
        ) ?? null;
      if (target !== current) {
        reset(current);
        current = target;
      }
      if (!target) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        const dx = (event.clientX - rect.left) / rect.width - 0.5;
        const dy = (event.clientY - rect.top) / rect.height - 0.5;
        target.style.setProperty("--ry", `${(dx * max * 2).toFixed(2)}deg`);
        target.style.setProperty("--rx", `${(-dy * max * 2).toFixed(2)}deg`);
        target.dataset.tilting = "true";
      });
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      reset(current);
      current = null;
    };
    root.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      reset(current);
    };
  }, [container, max, ready]);
}
