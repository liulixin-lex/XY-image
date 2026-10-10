"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { KeyGate, isKeyProblem } from "@/components/account/key-gate";
import { useAmbientImage } from "@/components/ambient/ambient-provider";
import { SHOWCASE_ITEMS, type ShowcaseItem } from "@/components/landing/showcase";
import { type ComposerHandle, Composer } from "@/components/studio/composer";
import { HistoryGrid } from "@/components/studio/history-grid";
import { JobQueue } from "@/components/studio/job-queue";
import { LoupeDialog } from "@/components/studio/loupe-dialog";
import { RecentStrip, ResultStage } from "@/components/studio/result-stage";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { MAX_ACTIVE_JOBS, useStudioJobs } from "@/hooks/use-studio-jobs";
import { useAccount, useImageModels } from "@/lib/account-context";
import { downloadImage } from "@/lib/download";
import { type ImageJobView, downloadName } from "@/lib/image-jobs";
import { findModelMeta } from "@/lib/image-model-meta";
import { type PendingDraft, takePendingDraft } from "@/lib/pending-prompt";

// Shown on the screen until the first result exists (labelled 示例).
const SAMPLE = SHOWCASE_ITEMS[0]!;
// Sample descriptions offered under an idle composer.
const SUGGESTIONS = SHOWCASE_ITEMS.slice(1, 5);
const STRIP_SIZE = 10;

function scrollToTop() {
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
}

/**
 * 生图: direct prompt-to-image in the lit room. The selected result hangs
 * on the screen and lights the page; the composer and the processing
 * queue sit at left, all results below.
 *
 * Jobs run in the async worker queue; this page never retries a request.
 */
export default function StudioPage() {
  const composer = useRef<ComposerHandle>(null);
  const { account } = useAccount();
  const models = useImageModels();
  const studio = useStudioJobs();
  const { success } = useToast();
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

  const results = useMemo(
    () => studio.jobs.filter((job) => job.status === "succeeded" && job.url),
    [studio.jobs],
  );
  const selected = results.find((job) => job.id === selectedId) ?? results[0] ?? null;

  // The room takes the colour of whatever is on the screen.
  useAmbientImage(
    studio.loading ? undefined : (selected?.url ?? SAMPLE.large),
    selected ? undefined : { amb: SAMPLE.amb, amb2: SAMPLE.amb2 },
  );

  // A result from this session that just finished goes straight on screen.
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
      return (
        models.data?.find((m) => m.id === id)?.displayName ??
        findModelMeta(id)?.displayName ??
        id
      );
    },
    [models.data],
  );

  const reuse = useCallback((job: ImageJobView) => {
    composer.current?.applyParams({
      prompt: job.prompt,
      model: job.model,
      quality: job.quality,
      aspectRatio: job.aspectRatio,
    });
    setLoupe(null);
    scrollToTop();
  }, []);

  const trySample = useCallback((sample: ShowcaseItem) => {
    composer.current?.applyParams({ prompt: sample.prompt, aspectRatio: sample.ratio });
    scrollToTop();
  }, []);

  const addAsReference = useCallback(
    (job: ImageJobView) => {
      if (!job.url || !job.assetId) return;
      composer.current?.addReference({ url: job.url, assetId: job.assetId, name: "之前的作品" });
      setLoupe(null);
      scrollToTop();
      success("已加入参考图");
    },
    [success],
  );

  const select = useCallback((job: ImageJobView) => {
    setSelectedId(job.id);
    scrollToTop();
  }, []);

  const download = useCallback((job: ImageJobView) => {
    if (job.url) void downloadImage(job.url, downloadName(job));
  }, []);

  const keyProblem = !models.loading && isKeyProblem(models.error) ? models.error : null;
  const noKeySelected = account.data !== null && account.data.preferences.image_key_id === null;
  const strip = useMemo(
    () => studio.jobs.filter((job) => job.status !== "canceled").slice(0, STRIP_SIZE),
    [studio.jobs],
  );

  return (
    <div className="overflow-x-clip pb-16">
      <section
        aria-label="生成"
        className="mx-auto grid max-w-[1600px] grid-cols-1 gap-x-[clamp(40px,5.6vw,96px)] gap-y-10 px-4 pt-2 sm:px-8 md:pt-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:px-12 xl:grid-cols-[minmax(0,600px)_minmax(0,1fr)]"
        style={{ "--stage-h": "clamp(380px, calc(100dvh - 300px), 620px)" } as React.CSSProperties}
      >
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(40px,4.5vw,66px)] leading-[1.05] font-normal text-fg">
            今天想
            <span className="text-[color-mix(in_oklab,rgb(var(--amb))_42%,white)] transition-colors duration-700">
              生成
            </span>
            点什么？
          </h1>

          <div className="mt-6 md:mt-7">
            {keyProblem || noKeySelected ? (
              <KeyGate reason={keyProblem ?? "key_unavailable"} />
            ) : models.loading && !models.data ? (
              <div className="h-[178px] animate-breathe rounded-[22px]" aria-label="正在读取模型" />
            ) : models.error && !models.data?.length ? (
              <div className="glass rounded-[22px] p-6 text-sm text-fg-soft">
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
                activeCount={studio.busyCount}
                maxActive={MAX_ACTIVE_JOBS}
              />
            )}
          </div>

          <JobQueue
            className="mt-8"
            jobs={studio.jobs}
            usageUrl={account.data?.links.usage ?? null}
            onCancel={(job) => void studio.cancel(job.id)}
            onReuse={reuse}
            onOpen={setLoupe}
            empty={
              <ul className="flex flex-col gap-2">
                {SUGGESTIONS.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => trySample(item)}
                      className="group flex w-full items-center gap-3 rounded-[14px] border border-line bg-tint/[0.03] py-2 pr-4 pl-2 text-left transition-colors hover:border-line-strong hover:bg-tint/[0.07]"
                    >
                      {/* biome-ignore lint/performance/noImgElement: static export */}
                      <img
                        src={item.src}
                        alt=""
                        loading="lazy"
                        className="size-10 shrink-0 rounded-[8px] object-cover opacity-80 transition-opacity group-hover:opacity-100"
                      />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-fg-soft group-hover:text-fg">
                        {item.prompt}
                      </span>
                      <span className="shrink-0 text-[12.5px] text-fg-muted group-hover:text-fg-soft">填入</span>
                    </button>
                  </li>
                ))}
              </ul>
            }
          />
        </div>

        <div className="min-w-0 lg:pt-1">
          <ResultStage
            job={selected}
            sample={SAMPLE}
            loading={studio.loading}
            modelName={modelName}
            onReuse={reuse}
            onDownload={download}
            onUseAsReference={addAsReference}
            onOpen={setLoupe}
            onUseSample={trySample}
          />
          <RecentStrip
            className="relative z-10 mt-8 lg:mt-14"
            jobs={strip}
            total={results.length}
            selectedId={selected?.id ?? null}
            onSelect={(job) => setSelectedId(job.id)}
            onOpen={setLoupe}
          />
        </div>
      </section>

      <section id="history" aria-labelledby="history-title" className="mx-auto mt-24 max-w-[1600px] scroll-mt-24 px-4 sm:px-8 lg:px-12">
        <h2 id="history-title" className="font-display text-[clamp(32px,3.4vw,46px)] leading-[1.05] font-normal text-fg">
          全部作品
        </h2>
        <div className="mt-8">
          {studio.loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="aspect-[4/5] animate-breathe rounded-[14px]" />
              ))}
            </div>
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
          ) : studio.jobs.length === 0 ? (
            <p className="max-w-[36em] text-[15px] leading-relaxed text-fg-soft">
              还没有作品。写一句描述，选好模型和比例，点「开始生成」。每张图都会按天排在这里，带着模型、尺寸和扣费状态。
            </p>
          ) : (
            <HistoryGrid
              jobs={studio.jobs}
              selectedId={selected?.id ?? null}
              modelName={modelName}
              justFinished={studio.justDeveloped}
              onSelect={select}
              onOpen={setLoupe}
              onReuse={reuse}
              onCancel={(job) => void studio.cancel(job.id)}
              onDownload={download}
            />
          )}
        </div>
        {studio.jobs.length >= 50 ? (
          <p className="mt-10 text-xs text-fg-muted">只显示最近 50 条记录。</p>
        ) : null}
      </section>

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
