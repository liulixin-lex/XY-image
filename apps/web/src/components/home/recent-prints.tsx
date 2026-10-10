"use client";

/**
 * The latest finished pictures as one row. The newest one lights the room.
 * Read-only: clicking opens the studio, where details and actions live.
 */
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { useAmbientImage } from "@/components/ambient/ambient-provider";
import { SHOWCASE_ITEMS } from "@/components/landing/showcase";
import { type ImageJobView, listImage, toImageJobView } from "@/lib/image-jobs";
import { describeImageParams } from "@/lib/image-model-meta";
import { fetchJobs } from "@/lib/server-api";
import { cn } from "@/lib/utils";

import { buttonVariants } from "../ui/button";

const LIMIT = 10;
// Lights the room until the first result exists.
const SAMPLE = SHOWCASE_ITEMS[0]!;

export function RecentPrints() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const [prints, setPrints] = useState<ImageJobView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchJobs(token, { jobType: "image_generation", status: "succeeded" })
      .then(({ jobs }) => {
        if (cancelled) return;
        setPrints(
          jobs
            .map(toImageJobView)
            .filter((job) => job.url)
            .slice(0, LIMIT),
        );
      })
      .catch((error) => {
        console.warn("[home] recent prints unavailable", error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // Load once per sign-in; token refreshes must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  // Sampled for colour only: the thumbnail is plenty and far cheaper.
  const latest = prints?.[0] ? listImage(prints[0]) : null;
  useAmbientImage(
    prints === null && !failed ? undefined : (latest ?? SAMPLE.large),
    latest ? undefined : { amb: SAMPLE.amb, amb2: SAMPLE.amb2 },
  );

  return (
    <section aria-labelledby="recent-prints">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="recent-prints" className="poster-label text-[26px] leading-none text-fg">
          最近生成
        </h2>
        <Link
          href="/studio"
          className="inline-flex items-center gap-1 text-[13px] text-fg-soft hover:text-fg"
        >
          去生图
          <ArrowRightIcon className="size-3.5" strokeWidth={1.75} />
        </Link>
      </div>

      {failed ? (
        <p className="rounded-[16px] bg-tint/[0.04] px-5 py-6 text-[13.5px] text-fg-soft">
          生成记录暂时读不到，稍后刷新页面再看。
        </p>
      ) : prints === null ? (
        <div className="flex gap-3 overflow-hidden" aria-label="读取中">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="sk aspect-[4/5] w-[156px] shrink-0 animate-breathe rounded-[14px]" />
          ))}
        </div>
      ) : prints.length === 0 ? (
        <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-[18px] px-5 py-5">
          <p className="text-[14px] text-fg-soft">还没有生成过图片。去「生图」写一句描述，就能出第一张。</p>
          <Link href="/studio" className={buttonVariants({ variant: "accent", size: "lg", slant: true })}>
            <span className="sk-in">
              去生图
              <ArrowRightIcon className="size-4" strokeWidth={2.2} />
            </span>
          </Link>
        </div>
      ) : (
        <ol className="-mx-2 flex gap-3.5 overflow-x-auto px-3 pt-2 pb-5 scrollbar-hidden">
          {prints.map((job, index) => (
            <li key={job.id} className="shrink-0">
              <Link
                href="/studio"
                className="group block w-[156px] rounded-[14px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-acc"
                title={job.prompt}
              >
                <span
                  className={cn(
                    "sk-frame relative block aspect-[4/5] rounded-[14px] bg-tint/[0.05] transition-[box-shadow,translate] duration-300 group-hover:-translate-y-1",
                    index === 0
                      ? "ring-picked"
                      : "shadow-[0_14px_26px_-18px_var(--shadow-2)] group-hover:shadow-[0_24px_40px_-20px_var(--shadow-2)]",
                  )}
                >
                  {/* biome-ignore lint/performance/noImgElement: public storage URL */}
                  <img
                    src={listImage(job) ?? ""}
                    alt={job.prompt || "生成结果"}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                </span>
                <span className="mt-2 flex items-center gap-2 pl-1">
                  <span className="numeral text-[18px] text-fg-soft">{String(index + 1).padStart(2, "0")}</span>
                  <span className="data-label text-fg-muted">
                    {describeImageParams({ resolution: job.resolution, quality: job.quality })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
