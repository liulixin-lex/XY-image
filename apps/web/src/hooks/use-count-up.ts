"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number that counts up to `target` the first time it is shown, then
 * follows it (第 62 条: admin figures). Reduced motion shows the value at
 * once. Cheap: one rAF loop for `duration` ms, no layout reads.
 */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(target);
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current || !Number.isFinite(target)) {
      setValue(target);
      return;
    }
    shown.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // expo out: quick start, gentle landing.
      setValue(target * (t === 1 ? 1 : 1 - 2 ** (-10 * t)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}
