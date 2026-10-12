"use client";

/**
 * 作品: every picture the account made (最近生成), in the studio, on a canvas
 * or by the design assistant, grouped by day and loaded page by page as the
 * list scrolls. 作品 in the top bar links straight here (第 57 条).
 *
 * 第 57 条 layout: one even grid of square tiles (the old masonry with a
 * caption under every picture read as scattered). A tile shows only its
 * picture; its model, source and time come up on hover over a progressive
 * blur, with 再来一次 / 以此为参考 / 下载. A sticky toolbar follows the scroll
 * with the day in view and the source filter (?source= in the URL).
 *
 * Read-only. 再来一次 and 以此为参考 fill the studio and go there; nothing
 * is sent from this page. Failed and 待核对 pictures stay in 设置 › 生成记录.
 */
import { IMAGE_JOB_SOURCES, type ImageJobSource } from "@loomic/shared";
import { ArrowUpIcon, ArrowUpRightIcon, DownloadIcon, ImagePlusIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAmbientImage } from "@/components/ambient/ambient-provider";
import { SHOWCASE_ITEMS, type ShowcaseItem } from "@/components/landing/showcase";
import { LoupeDialog } from "@/components/studio/loupe-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { useJobHistory } from "@/hooks/use-job-history";
import { useImageModels } from "@/lib/account-context";
import { downloadImage } from "@/lib/download";
import { groupByDay } from "@/lib/history";
import { type ImageJobView, downloadName, jobLabel, listImage } from "@/lib/image-jobs";
import { findModelMeta, isAspectRatio } from "@/lib/image-model-meta";
import { findModel, modelLabel } from "@/lib/image-model-ref";
import { savePendingDraft } from "@/lib/pending-prompt";
import { cn } from "@/lib/utils";

const SAMPLE = SHOWCASE_ITEMS[0] as ShowcaseItem;

const SOURCES: ReadonlyArray<{ value: ImageJobSource | null; label: string }> = [
  { value: null, label: "全部" },
  { value: "studio", label: "生图" },
  { value: "canvas", label: "画布" },
  { value: "assistant", label: "设计助手" },
];

const SOURCE_LABEL: Record<ImageJobSource, string> = {
  studio: "生图",
  canvas: "画布",
  assistant: "设计助手",
};

function isSource(value: string | null): value is ImageJobSource {
  return (IMAGE_JOB_SOURCES as readonly string[]).includes(value ?? "");
}

export default function HistoryPage() {
  // useSearchParams needs a Suspense boundary in a static export.
  return (
    <Suspense fallback={null}>
      <History />
    </Suspense>
  );
}

function History() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("source");
  const source = isSource(raw) ? raw : null;
  const setSource = useCallback(
    (next: ImageJobSource | null) => {
      router.replace(next ? `${pathname}?source=${next}` : pathname, { scroll: false });
      console.info("[history] source", { source: next });
    },
    [router, pathname],
  );

  const history = useJobHistory(source);
  const models = useImageModels();
  const [loupe, setLoupe] = useState<ImageJobView | null>(null);
  const groups = useMemo(() => groupByDay(history.items), [history.items]);

  // The newest picture lights the room.
  const first = history.items[0];
  useAmbientImage(
    !history.started ? undefined : ((first && listImage(first)) ?? SAMPLE.large),
    first ? undefined : { amb: SAMPLE.amb, amb2: SAMPLE.amb2 },
  );

  const modelName = useCallback(
    ({ model, keyId }: Pick<ImageJobView, "model" | "keyId">) => {
      if (!model) return "默认模型";
      const list = models.data ?? [];
      const listed = keyId
        ? list.find((m) => m.id === model && m.keyId === keyId)
        : findModel(list, { id: model, keyId: null });
      if (listed) return modelLabel(listed, list);
      return findModel(list, { id: model, keyId: null })?.displayName ?? findModelMeta(model)?.displayName ?? model;
    },
    [models.data],
  );

  const reuse = useCallback(
    (job: ImageJobView) => {
      savePendingDraft({
        prompt: job.prompt,
        ...(job.aspectRatio && isAspectRatio(job.aspectRatio) ? { aspectRatio: job.aspectRatio } : {}),
        resolution: job.resolution,
        ...(job.quality ? { quality: job.quality } : {}),
        ...(job.model ? { model: job.model } : {}),
        ...(job.keyId ? { keyId: job.keyId } : {}),
      });
      console.info("[history] 再来一次 → studio", { job: job.id });
      router.push("/studio");
    },
    [router],
  );
  const reference = useCallback(
    (job: ImageJobView) => {
      if (!job.url || !job.assetId) return;
      savePendingDraft({ prompt: "", reference: { url: job.url, assetId: job.assetId, name: "之前的作品" } });
      console.info("[history] 以此为参考 → studio", { job: job.id });
      router.push("/studio");
    },
    [router],
  );
  const download = useCallback((job: ImageJobView) => {
    if (job.url) void downloadImage(job.url, downloadName(job));
  }, []);

  // Next page as the end comes into view (a button stays as a fallback).
  const sentinel = useRef<HTMLDivElement>(null);
  const { loadMore } = history;
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  // The day in view, for the sticky toolbar.
  const [currentDay, setCurrentDay] = useState<string | null>(null);
  useEffect(() => {
    const sections = [...document.querySelectorAll<HTMLElement>("[data-day]")];
    if (!sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const top = visible[0]?.target.getAttribute("data-day");
        if (top) setCurrentDay(top);
      },
      // The band just under the sticky toolbar.
      { rootMargin: "-140px 0px -60% 0px" },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [groups]);

  const countText = history.items.length
    ? history.done
      ? `共 ${history.items.length} 张`
      : `已显示 ${history.items.length} 张`
    : null;

  return (
    <div className="pb-24">
      <div className="mx-auto max-w-[1600px] gutter-x">
        <header className="pt-4 md:pt-8">
          <div className="flex items-baseline gap-4">
            <h1 className="font-display text-[clamp(36px,4.2vw,56px)] leading-[1.02] font-normal text-fg">作品</h1>
            {countText ? <span className="data-label text-fg-muted tabular">{countText}</span> : null}
          </div>
          <p className="mt-2 max-w-[44em] text-[14.5px] leading-relaxed text-fg-soft">
            最近生成的每一张图，生图、画布和设计助手出的都在这里。点开看大图，或拿去再来一次。
          </p>
        </header>
      </div>

      <Toolbar source={source} onSource={setSource} day={currentDay} />

      <div className="mx-auto max-w-[1600px] gutter-x">
        {history.error && history.items.length === 0 ? (
          <div className="mt-6 flex flex-col items-start gap-3 rounded-[18px] border border-dashed border-line-strong px-6 py-8">
            <p className="text-[14px] text-fg">生成记录没有加载出来。</p>
            <Button variant="outline" onClick={history.retry}>
              重试
            </Button>
          </div>
        ) : !history.started ? (
          <HistorySkeleton />
        ) : history.items.length === 0 ? (
          <EmptyHistory source={source} />
        ) : (
          groups.map((group) => (
            <section
              key={group.label}
              data-day={group.label}
              aria-labelledby={`day-${group.label}`}
              className="scroll-mt-[150px] pt-8 first:pt-4"
            >
              <div className="mb-3.5 flex items-center gap-3">
                <h2 id={`day-${group.label}`} className="poster-label shrink-0 text-[18px] leading-none text-fg">
                  {group.label}
                </h2>
                <span className="data-label shrink-0 text-fg-muted tabular">{group.jobs.length} 张</span>
                <span aria-hidden className="h-px flex-1 bg-line" />
              </div>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(clamp(132px,15vw,200px),1fr))] gap-2.5 sm:gap-3">
                {group.jobs.map((job) => (
                  <li key={job.id} className="scroll-rise">
                    <HistoryTile
                      job={job}
                      modelName={modelName(job)}
                      onOpen={() => setLoupe(job)}
                      onReuse={() => reuse(job)}
                      onReference={() => reference(job)}
                      onDownload={() => download(job)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        <div ref={sentinel} aria-hidden className="h-px" />
        {history.items.length > 0 ? (
          <div className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-5 text-[13px] text-fg-muted">
            {history.done ? (
              <span>已经到底了。</span>
            ) : history.error ? (
              <Button variant="outline" size="sm" onClick={history.retry}>
                重试
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={loadMore} disabled={history.loading}>
                {history.loading ? "读取中…" : "加载更早的"}
              </Button>
            )}
            <Link href="/settings?tab=records" className="underline-offset-4 hover:text-fg hover:underline">
              没出图和待核对的在 设置 › 生成记录
            </Link>
          </div>
        ) : null}
      </div>

      <BackToTop />

      <LoupeDialog
        job={loupe}
        modelName={loupe ? modelName(loupe) : ""}
        onClose={() => setLoupe(null)}
        onReuse={(job) => {
          setLoupe(null);
          reuse(job);
        }}
        onUseAsReference={(job) => {
          setLoupe(null);
          reference(job);
        }}
        onDownload={download}
      />
    </div>
  );
}

/**
 * Follows the scroll under the top bar: the day in view at left, the source
 * filter at right. Clear at rest; once it sticks, the page dissolves into it
 * through the same progressive blur as the top bar.
 */
function Toolbar({
  source,
  onSource,
  day,
}: {
  source: ImageJobSource | null;
  onSource: (value: ImageJobSource | null) => void;
  day: string | null;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const top = window.matchMedia("(min-width: 768px)").matches ? 72 : 64;
    const observer = new IntersectionObserver(([entry]) => setStuck((entry?.intersectionRatio ?? 1) < 1), {
      rootMargin: `-${top + 1}px 0px 0px 0px`,
      threshold: [1],
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={bar} data-scrolled={stuck || undefined} className="sticky top-16 z-20 md:top-[72px]">
      <div aria-hidden className="progressive-veil">
        <i />
        <i />
        <i />
      </div>
      <div className="relative mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 gutter-x">
        <p
          aria-live="polite"
          className={cn(
            "poster-label truncate text-[15px] leading-none text-fg transition-opacity duration-200",
            stuck && day ? "opacity-100" : "opacity-0",
          )}
        >
          {day}
        </p>
        <div role="radiogroup" aria-label="来源" className="flex shrink-0 items-center gap-1 rounded-[13px] bg-tint/[0.05] p-1">
          {SOURCES.map((item) => {
            const active = item.value === source;
            return (
              <button
                key={item.label}
                type="button"
                // biome-ignore lint/a11y/useSemanticElements: chip-style radio, keeps the room's button styling
                role="radio"
                aria-checked={active}
                onClick={() => onSource(item.value)}
                className={cn(
                  "h-8 rounded-[9px] px-3 text-[13px] font-semibold transition-[background-color,color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:translate-y-px",
                  active
                    ? "bg-panel text-fg shadow-[0_1px_2px_var(--shadow),0_4px_12px_-6px_var(--shadow-2)]"
                    : "text-fg-soft hover:text-fg",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HistoryTile({
  job,
  modelName,
  onOpen,
  onReuse,
  onReference,
  onDownload,
}: {
  job: ImageJobView;
  modelName: string;
  onOpen: () => void;
  onReuse: () => void;
  onReference: () => void;
  onDownload: () => void;
}) {
  const label = jobLabel(job) || "（无描述）";
  const time = new Date(job.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const action =
    "flex size-8 items-center justify-center rounded-[9px] glass-ink transition-[filter,scale] hover:brightness-125 active:scale-95 focus-visible:outline-2 focus-visible:outline-white [&_svg]:size-4";
  const reveal =
    "invisible opacity-0 transition-[opacity,visibility] duration-200 group-focus-within/tile:visible group-focus-within/tile:opacity-100 pointer-fine:group-hover/tile:visible pointer-fine:group-hover/tile:opacity-100";
  return (
    <figure className="group/tile relative m-0 aspect-square overflow-hidden rounded-[12px] bg-tint/[0.06] shadow-[0_1px_2px_var(--shadow)] transition-[box-shadow,translate] duration-300 ease-(--ease-out-expo) pointer-fine:hover:-translate-y-0.5 pointer-fine:hover:shadow-card-hover">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`看大图：${label}`}
        title={label}
        className="absolute inset-0 block focus-visible:outline-none"
      >
        {/* biome-ignore lint/performance/noImgElement: public storage URL */}
        <img
          src={listImage(job) ?? ""}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover transition-transform duration-500 ease-(--ease-out-expo) pointer-fine:group-hover/tile:scale-[1.035]"
        />
      </button>
      {/* Details over a progressive blur, on hover or keyboard focus. */}
      <figcaption className={cn("pointer-events-none absolute inset-0", reveal)}>
        <span aria-hidden className="veil-bottom">
          <i />
          <i />
          <i />
        </span>
        <span className="absolute inset-x-2.5 bottom-2.5 flex flex-col gap-1 text-white">
          <span className="line-clamp-2 text-[12.5px] leading-snug font-medium">{label}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-white/80">
            <span className="shrink-0 rounded-[5px] bg-white/18 px-1.5 py-px font-semibold text-white">
              {SOURCE_LABEL[job.source]}
            </span>
            <span className="min-w-0 truncate">{modelName}</span>
            <span className="ml-auto shrink-0 tabular">{time}</span>
          </span>
        </span>
      </figcaption>
      <div className={cn("absolute top-2 right-2 flex gap-1 pointer-coarse:hidden", reveal)}>
        <button type="button" onClick={onReuse} title="再来一次：带上描述和设置去生图" aria-label="再来一次" className={action}>
          <RotateCcwIcon strokeWidth={2} />
        </button>
        {job.assetId ? (
          <button type="button" onClick={onReference} title="以此为参考：去生图，加到参考图" aria-label="以此为参考" className={action}>
            <ImagePlusIcon strokeWidth={2} />
          </button>
        ) : null}
        <button type="button" onClick={onDownload} title="下载" aria-label="下载" className={action}>
          <DownloadIcon strokeWidth={2} />
        </button>
        {job.canvasId ? (
          <Link href={`/canvas?id=${job.canvasId}`} title="打开它所在的画布" aria-label="打开画布" className={action}>
            <ArrowUpRightIcon strokeWidth={2} />
          </Link>
        ) : null}
      </div>
    </figure>
  );
}

/**
 * After a long scroll down the gallery, a way back to the filter and the
 * newest pictures. Above the phone's bottom bar.
 */
function BackToTop() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const update = () => setShown(window.scrollY > window.innerHeight * 1.5);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <button
      type="button"
      aria-label="回到顶部"
      title="回到顶部"
      tabIndex={shown ? 0 : -1}
      onClick={() =>
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        })
      }
      className={cn(
        "glass-float group fixed right-4 bottom-[calc(max(12px,env(safe-area-inset-bottom))+76px)] z-30 flex size-11 items-center justify-center rounded-full text-fg transition-[opacity,translate,scale] duration-300 ease-(--ease-out-expo) active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc md:right-8 md:bottom-8",
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
      )}
    >
      <ArrowUpIcon className="size-5 transition-transform duration-200 group-hover:-translate-y-0.5" strokeWidth={2} />
    </button>
  );
}

function HistorySkeleton() {
  return (
    <div className="pt-4" aria-label="读取中">
      <div className="mb-3.5 h-4 w-20 rounded-full bg-tint/[0.06]" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(clamp(132px,15vw,200px),1fr))] gap-2.5 sm:gap-3">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="aspect-square animate-breathe rounded-[12px]" />
        ))}
      </div>
    </div>
  );
}

function EmptyHistory({ source }: { source: ImageJobSource | null }) {
  return (
    <div className="glass mt-4 flex flex-wrap items-center justify-between gap-4 rounded-[18px] px-6 py-6">
      <p className="text-[14px] text-fg-soft">
        {source === null
          ? "还没有生成过图片。去「生图」写一句描述，就能出第一张。"
          : `「${SOURCE_LABEL[source]}」里还没有出过图。`}
      </p>
      <Link href="/studio" className={buttonVariants({ variant: "accent", size: "lg", slant: true })}>
        <span className="sk-in">去生图</span>
      </Link>
    </div>
  );
}
