"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { KeyGate, isKeyProblem } from "@/components/account/key-gate";
import { useAmbientImage } from "@/components/ambient/ambient-provider";
import { SAMPLE_ALT, SHOWCASE_ITEMS, type ShowcaseItem } from "@/components/landing/showcase";
import { BatchFeed, type FeedActions, groupAnchor } from "@/components/studio/batch-feed";
import { type ComposerHandle, Composer } from "@/components/studio/composer";
import { HistoryRail } from "@/components/studio/history-rail";
import { LoupeDialog } from "@/components/studio/loupe-dialog";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useStudioJobs } from "@/hooks/use-studio-jobs";
import { useAccount, useImageModels } from "@/lib/account-context";
import { downloadImage } from "@/lib/download";
import { type ImageJobView, type JobGroup, downloadName, groupByBatch } from "@/lib/image-jobs";
import { findModelMeta } from "@/lib/image-model-meta";
import { type PendingDraft, takePendingDraft } from "@/lib/pending-prompt";
import { cn } from "@/lib/utils";

// Lights the room until the first result exists.
const SAMPLE = SHOWCASE_ITEMS[0] as ShowcaseItem;
// Sample descriptions offered on an empty feed.
const SUGGESTIONS = SHOWCASE_ITEMS.slice(1, 5);

function smoothScroll(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * 生图 (F2): the settings panel at left, the requests at centre (one block
 * per click, 1 to 4 pictures each), and 记录 at right to jump through them.
 * The selected picture lights the room.
 *
 * Jobs run in the async worker queue; this page never retries a request.
 */
export default function StudioPage() {
  const composer = useRef<ComposerHandle>(null);
  const { account } = useAccount();
  const models = useImageModels();
  const studio = useStudioJobs();
  const { success, toast } = useToast();
  const [loupe, setLoupe] = useState<ImageJobView | null>(null);
  const [pendingDraft, setPendingDraft] = useState<PendingDraft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A prompt typed on the landing page before login lands here, unsent.
  useEffect(() => {
    const draft = takePendingDraft();
    if (draft) {
      setPendingDraft(draft);
      console.info("[studio] landing draft restored", { length: draft.prompt.length });
    }
  }, []);

  const visible = useMemo(
    // Canceled pictures that never left stay in 设置 › 记录; the feed shows what happened.
    () => studio.jobs.filter((job) => !(job.status === "canceled" && job.billing === "none" && !job.batchId)),
    [studio.jobs],
  );
  const groups = useMemo(() => groupByBatch(visible), [visible]);
  const results = useMemo(
    () => studio.jobs.filter((job) => job.status === "succeeded" && job.url),
    [studio.jobs],
  );
  const selected = results.find((job) => job.id === selectedId) ?? results[0] ?? null;
  const selectedGroup = selected ? (selected.batchId ?? selected.id) : null;

  // The room takes the colour of the selected picture.
  useAmbientImage(
    studio.loading ? undefined : (selected?.url ?? SAMPLE.large),
    selected ? undefined : { amb: SAMPLE.amb, amb2: SAMPLE.amb2 },
  );

  // A picture from this session that just finished becomes the selection.
  const seenFinished = useRef(new Set<string>());
  useEffect(() => {
    let latest: string | null = null;
    for (const id of studio.justDeveloped) {
      if (seenFinished.current.has(id)) continue;
      seenFinished.current.add(id);
      latest = id;
    }
    if (latest) setSelectedId(latest);
  }, [studio.justDeveloped]);

  // Keep the open dialog in sync with polling updates.
  useEffect(() => {
    if (!loupe) return;
    const fresh = studio.jobs.find((j) => j.id === loupe.id);
    if (fresh && fresh !== loupe) setLoupe(fresh);
  }, [studio.jobs, loupe]);

  const modelName = useCallback(
    (id: string | null) => {
      if (!id) return "默认模型";
      return models.data?.find((m) => m.id === id)?.displayName ?? findModelMeta(id)?.displayName ?? id;
    },
    [models.data],
  );

  const focusComposer = useCallback(() => {
    // On one column the composer is above the feed; bring it into view.
    if (!window.matchMedia("(min-width: 1024px)").matches)
      window.scrollTo({ top: 0, behavior: smoothScroll() });
  }, []);

  const reuse = useCallback(
    (job: ImageJobView) => {
      composer.current?.applyParams({
        prompt: job.prompt,
        model: job.model,
        quality: job.quality,
        aspectRatio: job.aspectRatio,
      });
      setLoupe(null);
      focusComposer();
    },
    [focusComposer],
  );

  const addAsReference = useCallback(
    (job: ImageJobView) => {
      if (!job.url || !job.assetId) return;
      composer.current?.addReference({ url: job.url, assetId: job.assetId, name: "之前的作品" });
      setLoupe(null);
      focusComposer();
      success("已加入参考图");
    },
    [focusComposer, success],
  );

  const variant = useCallback(
    (job: ImageJobView) => {
      if (!job.url || !job.assetId) return;
      composer.current?.applyParams({
        prompt: job.prompt,
        model: job.model,
        quality: job.quality,
        aspectRatio: job.aspectRatio,
      });
      composer.current?.addReference({ url: job.url, assetId: job.assetId, name: "变体来源" });
      focusComposer();
      toast("已填好描述和参考图，改几个字再生成");
    },
    [focusComposer, toast],
  );

  const download = useCallback((job: ImageJobView) => {
    if (job.url) void downloadImage(job.url, downloadName(job));
  }, []);

  const cancelBatch = useCallback(
    async (batchId: string) => {
      const canceled = await studio.cancelBatch(batchId);
      if (canceled > 0) success(`已取消 ${canceled} 张，没有发出，也没有扣费`);
      else toast("没有可以取消的了：剩下的已经发出，会生成完");
    },
    [studio, success, toast],
  );

  const actions = useMemo<FeedActions>(
    () => ({
      onSelect: (job) => setSelectedId(job.id),
      onOpen: setLoupe,
      onReference: addAsReference,
      onVariant: variant,
      onDownload: download,
      onReuse: reuse,
      onCancelJob: (job) => void studio.cancel(job.id),
      onCancelBatch: (batchId) => void cancelBatch(batchId),
    }),
    [addAsReference, cancelBatch, download, reuse, studio, variant],
  );

  const jump = useCallback((group: JobGroup) => {
    const picture = group.jobs.find((job) => job.status === "succeeded" && job.url);
    if (picture) setSelectedId(picture.id);
    document.getElementById(groupAnchor(group.key))?.scrollIntoView({ behavior: smoothScroll(), block: "start" });
  }, []);

  const keyProblem = !models.loading && isKeyProblem(models.error) ? models.error : null;
  const noKeySelected = account.data !== null && account.data.preferences.image_key_id === null;

  return (
    <div className="mx-auto grid max-w-[1680px] grid-cols-1 gap-6 px-4 pt-2 sm:px-6 lg:grid-cols-[minmax(320px,368px)_minmax(0,1fr)] lg:gap-8 lg:px-[clamp(16px,2vw,32px)] xl:grid-cols-[368px_minmax(0,1fr)_84px]">
      <h1 className="sr-only">生图</h1>

      <div className="min-w-0 lg:sticky lg:top-[84px] lg:h-[calc(100dvh-100px)] lg:self-start">
        {keyProblem || noKeySelected ? (
          <div className="glass rounded-[24px] p-5">
            <KeyGate reason={keyProblem ?? "key_unavailable"} />
          </div>
        ) : models.loading && !models.data ? (
          <div className="h-full min-h-[520px] animate-breathe rounded-[24px]" aria-label="正在读取模型" />
        ) : models.error && !models.data?.length ? (
          <div className="glass rounded-[24px] p-6 text-sm text-fg-soft">
            暂时读不到模型列表。
            <Button variant="outline" size="sm" className="ml-3" onClick={() => void models.refresh()}>
              重试
            </Button>
          </div>
        ) : (
          <Composer
            ref={composer}
            initialDraft={pendingDraft}
            models={models.data ?? []}
            onSubmit={studio.submit}
            submitting={studio.submitting}
            pendingCount={studio.busyCount}
            className="lg:h-full"
          />
        )}
      </div>

      <section aria-label="生成结果" className="min-w-0 pt-1 pb-10 lg:pt-4">
        {studio.loading ? (
          <FeedSkeleton />
        ) : studio.loadError && studio.jobs.length === 0 ? (
          <p className="text-sm text-fg-soft">
            作品记录读取失败。
            <button
              type="button"
              onClick={() => void studio.reload()}
              className="ml-1 font-medium text-fg underline underline-offset-4"
            >
              重试
            </button>
          </p>
        ) : groups.length === 0 ? (
          <EmptyFeed
            onPick={(item) => {
              composer.current?.applyParams({ prompt: item.prompt, aspectRatio: item.ratio });
              focusComposer();
            }}
          />
        ) : (
          <>
            <BatchFeed
              groups={groups}
              selectedId={selected?.id ?? null}
              justFinished={studio.justDeveloped}
              modelName={modelName}
              usageUrl={account.data?.links.usage ?? null}
              actions={actions}
            />
            {studio.jobs.length >= 50 ? (
              <p className="mt-12 text-xs text-fg-muted">这里只显示最近 50 张，更早的在 设置 › 记录。</p>
            ) : null}
          </>
        )}
      </section>

      {groups.length > 0 ? (
        <HistoryRail
          groups={groups}
          activeKey={selectedGroup}
          onJump={jump}
          className="hidden xl:sticky xl:top-[84px] xl:flex xl:h-[calc(100dvh-100px)] xl:self-start"
        />
      ) : null}

      <LoupeDialog
        job={loupe}
        modelName={loupe ? modelName(loupe.model) : ""}
        onClose={() => setLoupe(null)}
        onReuse={reuse}
        onUseAsReference={addAsReference}
        onDownload={download}
      />
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div aria-label="正在读取作品" className="flex flex-col gap-4">
      <div className="h-6 w-[min(28em,70%)] animate-breathe rounded-[8px]" />
      <div className="h-3.5 w-48 animate-breathe rounded-[6px]" />
      <div className="mt-2 grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={`skeleton-${i}`} className={cn("aspect-[3/4] animate-breathe rounded-[14px]", i > 1 && "max-md:hidden")} />
        ))}
      </div>
    </div>
  );
}

/** First visit: what will appear here, and four samples to start from. */
function EmptyFeed({ onPick }: { onPick: (item: ShowcaseItem) => void }) {
  return (
    <div>
      <h2 className="font-display text-[clamp(30px,3vw,44px)] leading-[1.1] font-normal text-fg">
        从一句<em className="text-acc not-italic">描述</em>开始
      </h2>
      <p className="mt-3 max-w-[36em] text-[15px] leading-relaxed text-fg-soft">
        在左边写好描述，选比例、画质和张数，点「生成」。每次生成的图会排在这里，每张都标着是否扣费和请求 ID。
      </p>
      <ul className="mt-9 grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-4">
        {SUGGESTIONS.map((item) => (
          <li key={item.id} className="min-w-0">
            <button type="button" onClick={() => onPick(item)} className="group block w-full text-left">
              <span className="relative block aspect-[3/4] overflow-hidden rounded-[14px] shadow-card transition-shadow group-hover:shadow-card-hover">
                {/* biome-ignore lint/performance/noImgElement: static export */}
                <img
                  src={item.src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  style={{ objectPosition: item.focus }}
                />
                <span className="absolute top-2.5 left-2.5 rounded-[8px] bg-[rgb(28_24_32/0.62)] px-2 py-1 text-[11.5px] font-semibold text-white backdrop-blur-sm">
                  {SAMPLE_ALT}
                </span>
              </span>
              <span className="mt-2.5 line-clamp-2 block text-[13.5px] leading-relaxed text-fg-soft group-hover:text-fg">
                {item.prompt}
              </span>
              <span className="mt-1.5 inline-flex text-[12.5px] font-semibold text-acc-text">用这句描述</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
