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
 * 再来一次 and 以此为参考 fill the studio and go there; nothing is sent
 * from this page. Failed and 待核对 pictures stay in 设置 › 生成记录.
 *
 * 第 58 条: pictures can be deleted (one from its tile, straight away with
 * 撤销 on the toast) and selected for batch actions: 「选择」 in the toolbar,
 * or the tick on a tile, then click, shift-click for a span, 选这一天, 全选.
 * The bar at the bottom downloads them as one ZIP, hands up to
 * REFERENCE_HANDOFF_MAX to the studio as references, or deletes them.
 */
import { IMAGE_JOB_SOURCES, type ImageJobSource } from "@loomic/shared";
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  CheckIcon,
  DownloadIcon,
  ImagePlusIcon,
  ListChecksIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAmbientImage } from "@/components/ambient/ambient-provider";
import { SHOWCASE_ITEMS, type ShowcaseItem } from "@/components/landing/showcase";
import { LoupeDialog } from "@/components/studio/loupe-dialog";
import { useToast } from "@/components/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { DeleteWorksDialog } from "@/components/works/delete-works-dialog";
import { SelectionBar } from "@/components/works/selection-bar";
import { useJobHistory } from "@/hooks/use-job-history";
import { useSelection } from "@/hooks/use-selection";
import { useImageModels } from "@/lib/account-context";
import { downloadImage } from "@/lib/download";
import { groupByDay } from "@/lib/history";
import { type ImageJobView, downloadName, jobLabel, listImage } from "@/lib/image-jobs";
import { findModelMeta, isAspectRatio, modelCapabilities } from "@/lib/image-model-meta";
import { findModel, modelLabel } from "@/lib/image-model-ref";
import { REFERENCE_HANDOFF_MAX, savePendingDraft } from "@/lib/pending-prompt";
import { cn } from "@/lib/utils";
import { downloadJobs, useDeleteWorks } from "@/lib/works-actions";
import { ZIP_MAX_ENTRIES } from "@/lib/zip";

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

  // --- 第 58 条: delete and multi-select ---
  const { show, error: toastError } = useToast();
  const order = useMemo(() => history.items.map((job) => job.id), [history.items]);
  const selection = useSelection(order);
  const [selecting, setSelecting] = useState(false);
  const [zipping, setZipping] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const canReference = useMemo(
    () => Boolean(models.data?.some((m) => modelCapabilities(m).maxInputImages > 0)),
    [models.data],
  );
  const { remove: removeItems, restore: restoreItems } = history;
  const { retain, clear } = selection;
  // Pictures that left the list (deleted, other filter) leave the selection.
  useEffect(() => retain(order), [order, retain]);
  const exitSelect = useCallback(() => {
    setSelecting(false);
    clear();
  }, [clear]);
  // A new filter is a new list: start over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the filter changes
  useEffect(() => exitSelect(), [source]);

  const deleteWorks = useDeleteWorks({
    onRemoved: (ids) => {
      removeItems(ids);
      setLoupe((open) => (open && ids.includes(open.id) ? null : open));
    },
    onRestored: restoreItems,
  });
  const selectedJobs = useMemo(
    () => history.items.filter((job) => selection.has(job.id)),
    [history.items, selection],
  );
  const startSelect = useCallback(
    (job?: ImageJobView) => {
      setSelecting(true);
      if (job) selection.toggle(job.id);
      console.info("[history] select mode", { from: job ? "tile" : "toolbar" });
    },
    [selection],
  );
  const downloadSelected = useCallback(async () => {
    const jobs = selectedJobs.slice(0, ZIP_MAX_ENTRIES);
    if (selectedJobs.length > ZIP_MAX_ENTRIES)
      show({ variant: "info", message: `一次最多打包 ${ZIP_MAX_ENTRIES} 张，先下载前 ${ZIP_MAX_ENTRIES} 张。` });
    setZipping(jobs.length > 1 ? `打包中 0/${jobs.length}` : "下载中");
    try {
      const { saved, failed } = await downloadJobs(jobs, (done, total) => setZipping(`打包中 ${done}/${total}`));
      if (failed) toastError(`${failed} 张没有下载下来${saved ? `，其余 ${saved} 张已打包` : ""}。`);
    } finally {
      setZipping(null);
    }
  }, [selectedJobs, show, toastError]);
  const referenceSelected = useCallback(() => {
    const refs = selectedJobs
      .filter((job) => job.url && job.assetId)
      .slice(0, REFERENCE_HANDOFF_MAX)
      .map((job) => ({ url: job.url as string, assetId: job.assetId as string, name: jobLabel(job).slice(0, 20) || "之前的作品" }));
    if (!refs.length) return;
    savePendingDraft({ prompt: "", references: refs });
    console.info("[history] 作参考 → studio", { count: refs.length });
    router.push("/studio");
  }, [selectedJobs, router]);
  const confirmDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const done = await deleteWorks(selectedJobs.map((job) => job.id));
      if (done.length) exitSelect();
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }, [deleteWorks, selectedJobs, exitSelect]);

  // Esc leaves the selection; ⌘A / Ctrl+A selects every loaded picture.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true], [role=dialog]")) return;
      if (event.key === "Escape") exitSelect();
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selection.toggleGroup(order);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, exitSelect, selection, order]);

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
      : null
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
            生图、画布和设计助手出的图都在这里。
          </p>
        </header>
      </div>

      <Toolbar
        source={source}
        onSource={setSource}
        day={currentDay}
        selecting={selecting}
        canSelect={history.items.length > 0}
        onSelect={() => (selecting ? exitSelect() : startSelect())}
      />

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
                {selecting ? (
                  <button
                    type="button"
                    onClick={() => selection.toggleGroup(group.jobs.map((job) => job.id))}
                    className="shrink-0 rounded-[8px] px-2 py-1 text-[12.5px] font-semibold text-fg-soft transition-colors hover:bg-tint/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
                  >
                    {group.jobs.every((job) => selection.has(job.id)) ? "取消这一天" : "选这一天"}
                  </button>
                ) : null}
              </div>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(clamp(132px,15vw,200px),1fr))] gap-2.5 sm:gap-3">
                {group.jobs.map((job) => (
                  <li key={job.id} className="scroll-rise">
                    <HistoryTile
                      job={job}
                      modelName={modelName(job)}
                      selecting={selecting}
                      selected={selection.has(job.id)}
                      onToggle={(range) => selection.toggle(job.id, { range })}
                      onStartSelect={() => startSelect(job)}
                      onOpen={() => setLoupe(job)}
                      onReuse={() => reuse(job)}
                      onReference={() => reference(job)}
                      onDownload={() => download(job)}
                      onDelete={() => void deleteWorks([job.id])}
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

      {selecting ? (
        <SelectionBar
          count={selection.size}
          total={history.items.length}
          allSelected={selection.size > 0 && selection.size === history.items.length}
          busy={zipping}
          onSelectAll={() => selection.toggleGroup(order)}
          onDownload={() => void downloadSelected()}
          onReference={canReference && selection.size <= REFERENCE_HANDOFF_MAX ? referenceSelected : undefined}
          onDelete={() => {
            if (selection.size === 1) void deleteWorks([...selection.ids]).then((done) => done.length && exitSelect());
            else setConfirming(true);
          }}
          onClose={exitSelect}
        />
      ) : (
        <BackToTop />
      )}

      <DeleteWorksDialog
        count={selection.size}
        open={confirming}
        deleting={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirming(false)}
      />

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
  selecting,
  canSelect,
  onSelect,
}: {
  source: ImageJobSource | null;
  onSource: (value: ImageJobSource | null) => void;
  day: string | null;
  selecting: boolean;
  canSelect: boolean;
  onSelect: () => void;
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
        <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onSelect}
          disabled={!canSelect && !selecting}
          aria-pressed={selecting}
          className={cn(
            "flex h-10 items-center gap-1.5 rounded-[13px] px-3 text-[13px] font-semibold transition-[background-color,color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:opacity-40 active:translate-y-px [&_svg]:size-4",
            selecting ? "bg-acc text-acc-ink" : "bg-tint/[0.05] text-fg-soft hover:text-fg",
          )}
        >
          {selecting ? <CheckIcon strokeWidth={2.25} /> : <ListChecksIcon strokeWidth={2} />}
          {selecting ? "完成" : "选择"}
        </button>
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
    </div>
  );
}

function HistoryTile({
  job,
  modelName,
  selecting,
  selected,
  onToggle,
  onStartSelect,
  onOpen,
  onReuse,
  onReference,
  onDownload,
  onDelete,
}: {
  job: ImageJobView;
  modelName: string;
  selecting: boolean;
  selected: boolean;
  /** `range`: shift-click, select the span from the last picture clicked. */
  onToggle: (range: boolean) => void;
  onStartSelect: () => void;
  onOpen: () => void;
  onReuse: () => void;
  onReference: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const label = jobLabel(job) || "（无描述）";
  const time = new Date(job.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const action =
    "flex size-8 items-center justify-center rounded-[9px] glass-ink transition-[filter,scale] hover:brightness-125 active:scale-95 focus-visible:outline-2 focus-visible:outline-white [&_svg]:size-4";
  const reveal =
    "invisible opacity-0 transition-[opacity,visibility] duration-200 group-focus-within/tile:visible group-focus-within/tile:opacity-100 pointer-fine:group-hover/tile:visible pointer-fine:group-hover/tile:opacity-100";
  return (
    <figure
      data-selected={selected || undefined}
      className={cn(
        "group/tile relative m-0 aspect-square overflow-hidden rounded-[12px] bg-tint/[0.06] shadow-[0_1px_2px_var(--shadow)] transition-[box-shadow,translate,scale] duration-300 ease-(--ease-out-expo)",
        !selecting && "pointer-fine:hover:-translate-y-0.5 pointer-fine:hover:shadow-card-hover",
        selected && "scale-[0.94] shadow-[0_0_0_2.5px_var(--acc),0_6px_18px_-8px_var(--shadow-2)]",
      )}
    >
      <button
        type="button"
        onClick={(event) => (selecting ? onToggle(event.shiftKey) : onOpen())}
        aria-label={selecting ? `${selected ? "取消选择" : "选择"}：${label}` : `看大图：${label}`}
        aria-pressed={selecting ? selected : undefined}
        title={label}
        className="absolute inset-0 block focus-visible:outline-none"
      >
        {/* biome-ignore lint/performance/noImgElement: public storage URL */}
        <img
          src={listImage(job) ?? ""}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "size-full object-cover transition-[scale,filter] duration-500 ease-(--ease-out-expo)",
            !selecting && "pointer-fine:group-hover/tile:scale-[1.035]",
            selecting && !selected && "brightness-[0.92]",
          )}
        />
      </button>
      {/* The tick: always there while selecting; on hover it starts a selection. */}
      <button
        type="button"
        tabIndex={selecting ? -1 : 0}
        aria-hidden={selecting || undefined}
        onClick={(event) => (selecting ? onToggle(event.shiftKey) : onStartSelect())}
        title={selecting ? undefined : "选择这张，开始多选"}
        aria-label={selecting ? undefined : "选中这张"}
        className={cn(
          "absolute top-2 left-2 z-10 flex size-6 items-center justify-center rounded-full border-2 transition-[opacity,background-color,border-color,scale] duration-200 focus-visible:outline-2 focus-visible:outline-white active:scale-90 [&_svg]:size-3.5",
          selected
            ? "border-acc bg-acc text-acc-ink"
            : "border-white/90 bg-black/25 text-transparent shadow-[0_1px_4px_rgba(0,0,0,0.35)] backdrop-blur-[2px]",
          selecting
            ? "opacity-100"
            : "opacity-0 group-focus-within/tile:opacity-100 pointer-fine:group-hover/tile:opacity-100 pointer-coarse:hidden",
        )}
      >
        <CheckIcon strokeWidth={3} />
      </button>
      {/* Details over a progressive blur, on hover or keyboard focus. */}
      <figcaption className={cn("pointer-events-none absolute inset-0", reveal, selecting && "hidden")}>
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
      <div className={cn("absolute top-2 right-2 flex gap-1 pointer-coarse:hidden", reveal, selecting && "hidden")}>
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
        <button type="button" onClick={onDelete} title="删除（可以撤销）" aria-label="删除" className={cn(action, "hover:text-[#ffb4c0]")}>
          <Trash2Icon strokeWidth={2} />
        </button>
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
