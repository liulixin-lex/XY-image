"use client";

import { type RefObject, useEffect } from "react";

/**
 * Horizontal rail scrolling for a mouse: drag with the left button, and turn
 * a plain vertical wheel into horizontal travel while the rail can still move
 * that way (at either end the wheel scrolls the page as usual, so the rail
 * never traps it). Touch and trackpads already scroll natively and are left
 * alone.
 *
 * The click that ends a drag is swallowed so it does not trigger a card.
 * While dragging, `data-dragging="true"` is set on the rail (for cursor and
 * snap styles).
 */
export function useDragScroll(rail: RefObject<HTMLElement | null>, { wheel = false }: { wheel?: boolean } = {}) {
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    let startX = 0;
    let startScroll = 0;
    let dragging = false;
    let moved = false;
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startScroll = el.scrollLeft;
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      if (moved) {
        el.scrollLeft = startScroll - dx;
        el.dataset.dragging = "true";
      }
    };
    const up = () => {
      dragging = false;
      delete el.dataset.dragging;
    };
    const click = (event: MouseEvent) => {
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        moved = false;
      }
    };
    const onWheel = (event: WheelEvent) => {
      // Trackpads send deltaX themselves; only remap a mouse wheel.
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const towardEnd = event.deltaY > 0;
      if ((towardEnd && el.scrollLeft >= max - 1) || (!towardEnd && el.scrollLeft <= 0)) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("click", click, true);
    if (wheel) el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("click", click, true);
      el.removeEventListener("wheel", onWheel);
    };
  }, [rail, wheel]);
}
