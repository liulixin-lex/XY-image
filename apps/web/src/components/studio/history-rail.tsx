"use client";

import { CircleAlertIcon, ImageOffIcon } from "lucide-react";

import { type JobGroup, describeOutcome, isActiveJob } from "@/lib/image-jobs";
import { cn } from "@/lib/utils";

import { groupAnchor } from "./batch-feed";

/**
 * 记录: one thumbnail per request, newest first, to jump through the feed.
 * A dot marks requests that need a look (待核对) or are still running;
 * the words are in the feed and in the button's label.
 */
export function HistoryRail({
  groups,
  activeKey,
  onJump,
  className,
}: {
  groups: JobGroup[];
  /** Group of the selected picture. */
  activeKey: string | null;
  onJump: (group: JobGroup) => void;
  className?: string;
}) {
  return (
    <nav aria-label="记录" className={cn("glass flex flex-col rounded-[22px] py-4", className)}>
      <p className="poster-label px-3 text-center text-[15px] leading-none text-fg">记录</p>
      <ol className="mt-4 flex min-h-0 flex-1 flex-col items-center gap-2.5 overflow-y-auto px-2 pb-1 scrollbar-hidden">
        {groups.map((group) => {
          const picture = group.jobs.find((job) => job.status === "succeeded" && job.url);
          const running = group.jobs.some(isActiveJob);
          const toCheck = group.jobs.some((job) => describeOutcome(job).tone === "unknown");
          const state = running ? "，生成中" : toCheck ? "，有待核对的" : "";
          return (
            <li key={group.key} className="relative">
              <button
                type="button"
                onClick={() => onJump(group)}
                aria-current={group.key === activeKey ? "true" : undefined}
                aria-label={`${group.lead.prompt || "无描述"}${state}`}
                title={group.lead.prompt}
                className={cn(
                  "block size-[54px] overflow-hidden rounded-[12px] transition-[box-shadow,scale] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
                  group.key === activeKey ? "ring-picked" : "shadow-[0_6px_14px_-8px_var(--shadow-2)] hover:scale-[1.04]",
                )}
              >
                {picture?.url ? (
                  // biome-ignore lint/performance/noImgElement: signed storage URL
                  <img src={picture.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <span
                    className={cn(
                      "flex h-full w-full items-center justify-center",
                      running
                        ? "bg-[repeating-linear-gradient(135deg,var(--acc-soft)_0_6px,transparent_6px_12px)]"
                        : toCheck
                          ? "bg-warn-wash text-warn"
                          : "bg-tint/[0.07] text-fg-muted",
                    )}
                  >
                    {running ? null : toCheck ? (
                      <CircleAlertIcon className="size-5" strokeWidth={1.75} />
                    ) : (
                      <ImageOffIcon className="size-5" strokeWidth={1.75} />
                    )}
                  </span>
                )}
              </button>
              {running || toCheck ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute -top-1 -right-1 size-3 rounded-full ring-2 ring-[var(--ground)]",
                    running ? "animate-live bg-acc" : "bg-warn",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
