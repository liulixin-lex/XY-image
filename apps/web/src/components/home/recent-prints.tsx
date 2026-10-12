"use client";

/**
 * The latest finished pictures as one row. The newest one lights the room.
 * Read-only: clicking opens 最近生成 (第 56 条), where every picture is, with
 * its details and actions.
 *
 * 第 57 条: the row could not be moved right with a mouse (its scrollbar is
 * hidden and a wheel scrolls the page). Now: ‹ › buttons, drag with the
 * mouse, snapping, keyboard focus, a progressive blur at whichever end has
 * more pictures, and a 查看全部 card at the end.
 */
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { useAmbientImage } from "@/components/ambient/ambient-provider";
import { SHOWCASE_ITEMS } from "@/components/landing/showcase";
import { type ImageJobView, jobLabel, listImage, toImageJobView } from "@/lib/image-jobs";
import { describeImageParams } from "@/lib/image-model-meta";
import { fetchJobs } from "@/lib/server-api";
import { cn } from "@/lib/utils";

import { buttonVariants } from "../ui/button";

const LIMIT = 16;
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
    fetchJobs(token, { jobType: "image_generation", status: "succeeded", limit: 16 })
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

  const strip = useStripScroll(prints?.length ?? 0);

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
          href="/history"
          className="group inline-flex items-center gap-1 text-[13px] font-semibold text-fg-soft hover:text-fg"
        >
          查看全部
          <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
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
        <div
          className="group/strip relative -mx-2"
          data-more-left={strip.more.left || undefined}
          data-more-right={strip.more.right || undefined}
        >
        <ol
          ref={strip.ref}
          aria-label="最近生成的图片"
          onPointerDown={strip.onPointerDown}
          onClickCapture={strip.onClickCapture}
          className="flex snap-x snap-proximity gap-3.5 overflow-x-auto scroll-smooth px-3 pt-2 pb-5 scrollbar-hidden select-none data-[dragging]:cursor-grabbing data-[dragging]:snap-none data-[dragging]:scroll-auto pointer-fine:cursor-grab"
        >
          {prints.map((job, index) => (
            <li key={job.id} className="shrink-0 snap-start">
              <Link
                href="/history"
                draggable={false}
                className="group block w-[156px] rounded-[14px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-acc"
                title={jobLabel(job)}
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
                    alt={jobLabel(job) || "生成结果"}
                    loading="lazy"
                    draggable={false}
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
          <li className="shrink-0 snap-start">
            <Link
              href="/history"
              draggable={false}
              className="group flex aspect-[4/5] w-[156px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-strong text-[13px] font-semibold text-fg-soft transition-[background-color,color,border-color] hover:border-fg-muted hover:bg-tint/[0.04] hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-acc"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-tint/[0.06] transition-transform group-hover:translate-x-0.5">
                <ArrowRightIcon className="size-4" strokeWidth={2.2} />
              </span>
              查看全部
            </Link>
          </li>
        </ol>
        <span aria-hidden className="edge-blur" data-side="left">
          <i />
          <i />
        </span>
        <span aria-hidden className="edge-blur" data-side="right">
          <i />
          <i />
        </span>
        <StripButton side="left" hidden={!strip.more.left} onClick={() => strip.page(-1)} />
        <StripButton side="right" hidden={!strip.more.right} onClick={() => strip.page(1)} />
        </div>
      )}
    </section>
  );
}

/**
 * Scrolling the strip: which ends have more, paging by most of a screen, and
 * dragging with a mouse (touch and trackpads scroll natively). A drag that
 * moved swallows the click at its end so it does not open a picture.
 */
function useStripScroll(count: number) {
  const ref = useRef<HTMLOListElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setMore((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the pictures change
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure, count]);

  const page = useCallback((direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.max(200, el.clientWidth * 0.8),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, []);

  const dragged = useRef(false);
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLOListElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    const startX = event.clientX;
    const startLeft = el.scrollLeft;
    dragged.current = false;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      if (!dragged.current && Math.abs(dx) < 5) return;
      if (!dragged.current) {
        dragged.current = true;
        el.dataset.dragging = "";
      }
      el.scrollLeft = startLeft - dx;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      delete el.dataset.dragging;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);
  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!dragged.current) return;
    dragged.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return { ref, more, page, onPointerDown, onClickCapture };
}

function StripButton({ side, hidden, onClick }: { side: "left" | "right"; hidden: boolean; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={hidden ? -1 : 0}
      aria-hidden={hidden || undefined}
      aria-label={side === "left" ? "往前看" : "往后看"}
      className={cn(
        "glass-float absolute top-[calc(50%-14px)] z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-fg transition-[opacity,scale] duration-200 hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc pointer-coarse:hidden",
        side === "left" ? "left-1" : "right-1",
        hidden ? "pointer-events-none opacity-0" : "opacity-0 group-hover/strip:opacity-100 focus-visible:opacity-100",
      )}
    >
      <Icon className="size-5" strokeWidth={2.2} />
    </button>
  );
}
