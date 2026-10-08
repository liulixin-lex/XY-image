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
import { type ImageJobView, toImageJobView } from "@/lib/image-jobs";
import { QUALITY_LABEL } from "@/lib/image-model-meta";
import { fetchJobs } from "@/lib/server-api";

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

  const latest = prints?.[0]?.url ?? null;
  useAmbientImage(
    prints === null && !failed ? undefined : (latest ?? SAMPLE.large),
    latest ? undefined : { amb: SAMPLE.amb, amb2: SAMPLE.amb2 },
  );

  return (
    <section aria-labelledby="recent-prints">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="recent-prints" className="text-[18px] font-semibold text-fg">
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
        <p className="rounded-[16px] border border-dashed border-line-strong px-5 py-6 text-[13.5px] text-fg-soft">
          生成记录暂时读不到，稍后刷新页面再看。
        </p>
      ) : prints === null ? (
        <div className="flex gap-3 overflow-hidden" aria-label="读取中">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="aspect-[4/5] w-[156px] shrink-0 animate-breathe rounded-[14px]" />
          ))}
        </div>
      ) : prints.length === 0 ? (
        <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-[18px] px-5 py-5">
          <p className="text-[14px] text-fg-soft">还没有生成过图片。去「生图」写一句描述，就能出第一张。</p>
          <Link
            href="/studio"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-fg px-4 text-[14px] font-semibold text-ground glow-amb transition-colors hover:bg-white"
          >
            去生图
            <ArrowRightIcon className="size-4" strokeWidth={2} />
          </Link>
        </div>
      ) : (
        <ol className="-mx-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-4 scrollbar-hidden">
          {prints.map((job, index) => (
            <li key={job.id} className="shrink-0">
              <Link
                href="/studio"
                className={
                  "group block w-[156px] overflow-hidden rounded-[14px] shadow-[0_0_0_1px_rgb(255_255_255/0.08)] transition-[box-shadow,transform] duration-300 outline-none hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgb(255_255_255/0.2),0_24px_50px_-26px_rgb(2_4_10/0.9),0_0_44px_-14px_rgb(var(--amb)/0.6)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amb" +
                  (index === 0 ? " shadow-[0_0_0_1.5px_rgb(255_255_255/0.6),0_0_40px_-12px_rgb(var(--amb)/0.7)]" : "")
                }
                title={job.prompt}
              >
                <span className="relative block aspect-[4/5] bg-white/[0.05]">
                  {/* biome-ignore lint/performance/noImgElement: public storage URL */}
                  <img
                    src={job.url!}
                    alt={job.prompt || "生成结果"}
                    loading="lazy"
                    className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                  />
                  <span className="absolute right-2 bottom-2 rounded-full bg-ground-deep/60 px-2 py-0.5 text-[11px] font-medium text-fg backdrop-blur-md">
                    {QUALITY_LABEL[job.quality]}
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
