"use client";

/**
 * 最近生成 (第 56 条): every picture the account made, in the studio, on a
 * canvas or by the design assistant, grouped by day and loaded page by page
 * as the list scrolls. Reached from 作品 › 最近生成 in the top bar.
 *
 * Read-only. 再来一次 and 以此为参考 fill the studio and go there; nothing
 * is sent from this page. Failed and 待核对 pictures stay in 设置 › 生成记录.
 */
import type { ImageJobSource } from "@loomic/shared";
import {
  ArrowUpRightIcon,
  DownloadIcon,
  ImagePlusIcon,
  RotateCcwIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAmbientImage } from "@/components/ambient/ambient-provider";
import { SHOWCASE_ITEMS, type ShowcaseItem } from "@/components/landing/showcase";
import { PageHeader } from "@/components/page-header";
import { LoupeDialog } from "@/components/studio/loupe-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { WorksTabs } from "@/components/works/works-nav";
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

export default function HistoryPage() {
  const router = useRouter();
  const [source, setSource] = useState<ImageJobSource | null>(null);
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

  return (
    <div className="pb-24">
      <PageHeader
        eyebrow={<WorksTabs />}
        title="最近生成"
        description="生图、画布和设计助手出的每一张图，按日期排好。点开看大图，或拿去再来一次。"
        aside={
          history.items.length ? (
            <span className="data-label text-fg-muted tabular">
              {history.done ? `共 ${history.items.length} 张` : `已显示 ${history.items.length} 张`}
            </span>
          ) : null
        }
      />

      <div className="mx-auto max-w-[1600px] px-4 sm:px-8 lg:px-12">
        <FilterBar source={source} onSource={setSource} />

        {history.error && history.items.length === 0 ? (
          <div className="mt-8 flex flex-col items-start gap-3 rounded-[18px] border border-dashed border-line-strong px-6 py-8">
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
          <div className="mt-6 flex flex-col gap-12">
            {groups.map((group) => (
              <section key={group.label} aria-labelledby={`day-${group.label}`}>
                <div className="mb-4 flex items-baseline gap-3">
                  <h2 id={`day-${group.label}`} className="poster-label text-[22px] leading-none text-fg">
                    {group.label}
                  </h2>
                  <span className="data-label text-fg-muted tabular">{group.jobs.length} 张</span>
                </div>
                <ul className="columns-2 gap-4 sm:columns-3 lg:columns-4 2xl:columns-5">
                  {group.jobs.map((job) => (
                    <li key={job.id} className="mb-4 break-inside-avoid">
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
            ))}
          </div>
        )}

        <div ref={sentinel} aria-hidden className="h-px" />
        {history.items.length > 0 ? (
          <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-fg-muted">
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
 * The source filter; it sticks under the top bar while the list scrolls
 * and turns to frosted glass once it does.
 */
function FilterBar({
  source,
  onSource,
}: {
  source: ImageJobSource | null;
  onSource: (value: ImageJobSource | null) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    // Stuck once its top reaches the sticky offset (the bar height + 8 px).
    const observer = new IntersectionObserver(([entry]) => setStuck((entry?.intersectionRatio ?? 1) < 1), {
      rootMargin: "-81px 0px 0px 0px",
      threshold: [1],
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={bar}
      data-stuck={stuck || undefined}
      className="sticky top-[80px] z-20 -mx-2 w-fit max-w-full rounded-[16px] px-2 py-2 transition-[background-color,box-shadow,backdrop-filter] duration-300 data-[stuck]:glass-strong data-[stuck]:shadow-[0_12px_32px_-20px_var(--shadow-2)] md:top-[80px]"
    >
      <div role="radiogroup" aria-label="来源" className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[13px] text-fg-muted">来源</span>
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
                "sk h-8 rounded-[9px] px-3.5 text-[13px] font-semibold transition-[background-color,color,translate] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
                active ? "bg-fg text-ground" : "bg-tint/[0.055] text-fg-soft hover:bg-tint/[0.1] hover:text-fg",
              )}
            >
              <span className="sk-in">{item.label}</span>
            </button>
          );
        })}
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
  const ratio = job.width && job.height ? `${job.width} / ${job.height}` : "4 / 5";
  const label = jobLabel(job) || "（无描述）";
  const action =
    "flex size-8 items-center justify-center rounded-[9px] bg-[rgb(28_24_32/0.62)] text-white backdrop-blur-md transition-[background-color,scale] hover:bg-[rgb(28_24_32/0.82)] active:scale-95 focus-visible:outline-2 focus-visible:outline-white [&_svg]:size-4";
  return (
    <figure className="group/tile m-0">
      <div
        className="relative overflow-hidden rounded-[14px] bg-tint/[0.05] shadow-card transition-[box-shadow,translate] duration-300 hover:-translate-y-0.5 hover:shadow-card-hover"
        style={{ aspectRatio: ratio }}
      >
        <button
          type="button"
          onClick={onOpen}
          aria-label={`看大图：${label}`}
          className="absolute inset-0 block focus-visible:outline-none"
        >
          {/* biome-ignore lint/performance/noImgElement: public storage URL */}
          <img
            src={listImage(job) ?? ""}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-500 group-hover/tile:scale-[1.02]"
          />
          {/* Progressive veil: legible caption without a hard band. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[rgb(20_16_24/0.72)] via-[rgb(20_16_24/0.28)] to-transparent opacity-0 transition-opacity duration-300 group-focus-within/tile:opacity-100 pointer-fine:group-hover/tile:opacity-100"
          />
          <span className="pointer-events-none absolute inset-x-3 bottom-2.5 line-clamp-2 text-left text-[12.5px] leading-snug text-white opacity-0 transition-opacity duration-300 group-focus-within/tile:opacity-100 pointer-fine:group-hover/tile:opacity-100">
            {label}
          </span>
        </button>
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity duration-200 group-focus-within/tile:opacity-100 pointer-coarse:opacity-100 pointer-fine:group-hover/tile:opacity-100">
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
        </div>
      </div>
      <figcaption className="mt-2 flex min-w-0 items-center gap-2 text-[12px]">
        <span
          className={cn(
            "inline-flex h-[20px] shrink-0 items-center rounded-[6px] px-1.5 text-[11px] font-semibold",
            job.source === "studio" ? "bg-acc-soft text-acc-text" : "bg-tint/[0.07] text-fg-soft",
          )}
        >
          {SOURCE_LABEL[job.source]}
        </span>
        <span className="min-w-0 truncate text-fg-soft" title={modelName}>
          {modelName}
        </span>
        {job.canvasId ? (
          <Link
            href={`/canvas?id=${job.canvasId}`}
            className="ml-auto inline-flex shrink-0 items-center gap-0.5 font-semibold text-fg-muted hover:text-fg"
            title="打开它所在的画布"
          >
            画布
            <ArrowUpRightIcon className="size-3" strokeWidth={2.2} />
          </Link>
        ) : (
          <span className="ml-auto shrink-0 text-fg-muted tabular">
            {new Date(job.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function HistorySkeleton() {
  const heights = [280, 210, 340, 250, 300, 220, 260, 320];
  return (
    <div className="mt-6" aria-label="读取中">
      <div className="mb-4 h-5 w-16 rounded-full bg-tint/[0.06]" />
      <div className="columns-2 gap-4 sm:columns-3 lg:columns-4 2xl:columns-5">
        {heights.map((height, i) => (
          <div key={i} className="mb-4 animate-breathe rounded-[14px]" style={{ height }} />
        ))}
      </div>
    </div>
  );
}

function EmptyHistory({ source }: { source: ImageJobSource | null }) {
  return (
    <div className="glass mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[18px] px-6 py-6">
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
