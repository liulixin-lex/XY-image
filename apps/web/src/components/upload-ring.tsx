"use client";

import { cn } from "../lib/utils";

/**
 * A ring that fills as a picture uploads: real progress from the upload
 * (lib/server-api.ts uploadFileWithProgress), never a made-up one. Without
 * a number yet (the browser has not reported, or the picture waits for a
 * slot) it is an arc that turns. Colour comes from `currentColor`.
 */
export function UploadRing({
  progress,
  size = 28,
  stroke = 3,
  label,
  className,
}: {
  /** 0–1, or null/undefined while unknown. */
  progress: number | null | undefined;
  size?: number;
  stroke?: number;
  /** Spoken name, e.g. 「上传中」. Leave out when the ring sits beside text that says it. */
  label?: string;
  className?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const known = typeof progress === "number" && Number.isFinite(progress);
  const value = known ? Math.min(1, Math.max(0, progress)) : 0.28;
  const centre = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn(
        "shrink-0",
        !known && "animate-spin [animation-duration:1.1s] motion-reduce:animate-none",
        className,
      )}
      {...(label
        ? {
            role: "progressbar",
            "aria-label": label,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            ...(known ? { "aria-valuenow": Math.round(value * 100) } : {}),
          }
        : { "aria-hidden": true })}
    >
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.22}
        strokeWidth={stroke}
      />
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value)}
        transform={`rotate(-90 ${centre} ${centre})`}
        className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
      />
    </svg>
  );
}
