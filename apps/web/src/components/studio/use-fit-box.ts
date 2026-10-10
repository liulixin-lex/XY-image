"use client";

import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * The largest width × height box of the given shape that fits in the
 * element, kept up to date as it resizes. Null until first measured.
 */
export function useFitBox(
  ref: RefObject<HTMLElement | null>,
  width: number,
  height: number,
): { width: number; height: number } | null {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !(width > 0 && height > 0)) return;
    const measure = () => {
      const fit = Math.min(element.clientWidth / width, element.clientHeight / height);
      if (!(fit > 0)) return;
      const next = { width: Math.floor(width * fit), height: Math.floor(height * fit) };
      setBox((prev) =>
        prev && prev.width === next.width && prev.height === next.height ? prev : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, width, height]);
  return box;
}
