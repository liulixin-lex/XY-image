"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { ShowcaseItem } from "./showcase";

/**
 * Every sample on a wall tilted back in 3D, its columns drifting up and down
 * in turn (Aceternity 3D Marquee). Each column holds its pictures four times and moves by one
 * copy (globals.css wall-up / wall-down), so the loop is seamless. Decorative: the
 * pictures are listed with their captions in the 示例 section above.
 * Every width (第 63 条): phones show five wider columns, centred lower so
 * they fill the band under the words; from md up all eight, to the right.
 * Reduced motion: the wall stands still.
 *
 * The tiles mount only when the wall comes within a screen of the viewport
 * and then load eagerly: native lazy loading misjudges positions inside a
 * 3D-transformed box and left gaps in the wall.
 */
export function ImageWall({
  items,
  className,
}: { items: ShowcaseItem[]; className?: string }) {
  const columns = 8;
  // Same length for every column (six pictures, all cut to 3:4), so every
  // column covers the middle of the wall at every point of its loop.
  const cols = Array.from({ length: columns }, (_, c) =>
    Array.from(
      { length: 6 },
      (_, k) => items[(c * 3 + k * 5) % items.length] as ShowcaseItem,
    ),
  );
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={box}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden [perspective:1400px]",
        className,
      )}
    >
      {near ? (
        <div
          className="absolute top-[70%] left-1/2 grid w-[200%] grid-cols-5 gap-3 [transform:translate(-50%,-50%)_rotateX(50deg)_rotateZ(-36deg)] md:top-1/2 md:w-[125%] md:grid-cols-8 md:[transform:translate(-38%,-50%)_rotateX(50deg)_rotateZ(-36deg)]"
          style={{ transformStyle: "preserve-3d" } as CSSProperties}
        >
          {cols.map((col, c) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns
              key={c}
              className={cn(
                "flex flex-col gap-3 self-start",
                c % 2 ? "wall-col-down" : "wall-col-up",
                // Phones keep the first five columns.
                c >= 5 && "max-md:hidden",
              )}
              style={{ animationDuration: `${40 + (c % 4) * 8}s` }}
            >
              {[...col, ...col, ...col, ...col].map((item, i) => (
                <div
                  key={`${item.id}-${i}`}
                  className="aspect-[3/4] overflow-hidden rounded-[10px] shadow-[0_18px_30px_-18px_rgb(0_0_0/0.7)]"
                >
                  {/* biome-ignore lint/performance/noImgElement: static export */}
                  <img
                    src={item.src}
                    alt=""
                    decoding="async"
                    className="h-full w-full object-cover"
                    style={{ objectPosition: item.focus }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
