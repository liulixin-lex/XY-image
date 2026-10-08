"use client";

import { BrandMark } from "./brand/brand-mark";

/**
 * Full-screen wait state: the mark glowing in the dark room, with a
 * breathing status dot. No spinner.
 */
export function LoadingScreen({ label = "正在载入" }: { label?: string }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[radial-gradient(60%_50%_at_50%_45%,rgb(var(--amb)/0.14),transparent_70%),var(--color-ground)]"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-5">
        <BrandMark className="size-12" aria-hidden title="" />
        <span className="flex items-center gap-2 text-[13px] text-fg-muted">
          <span className="inline-block size-1.5 rounded-full bg-live animate-live" />
          {label}
        </span>
      </div>
    </div>
  );
}
