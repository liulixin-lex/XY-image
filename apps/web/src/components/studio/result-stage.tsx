"use client";

import {
  ArrowDownIcon,
  DownloadIcon,
  ImagePlusIcon,
  Maximize2Icon,
  RotateCcwIcon,
} from "lucide-react";

import {
  type ImageJobView,
  dayLabel,
  formatTime,
  isActiveJob,
  isFailedJob,
  jobAspect,
  jobStatusLabel,
} from "@/lib/image-jobs";
import { QUALITY_LABEL } from "@/lib/image-model-meta";
import { cn } from "@/lib/utils";

import { LightScreen } from "../ambient/light-screen";
import { BillingBadge, needsReconcile } from "../billing/billing-badge";
import { SAMPLE_ALT, type ShowcaseItem } from "../landing/showcase";
import { Button } from "../ui/button";

const SAMPLE_RATIO: Record<string, number> = { "3:4": 3 / 4, "4:3": 4 / 3 };

/**
 * The studio's screen: the selected result hangs tilted in the room and
 * lights it; a glass card beside it carries the prompt, billing and the
 * next actions. Before the first result it shows a sample, labelled.
 */
export function ResultStage({
  job,
  sample,
  loading,
  modelName,
  onReuse,
  onDownload,
  onUseAsReference,
  onOpen,
  onUseSample,
}: {
  job: ImageJobView | null;
  sample: ShowcaseItem;
  loading: boolean;
  modelName: (id: string | null) => string;
  onReuse: (job: ImageJobView) => void;
  onDownload: (job: ImageJobView) => void;
  onUseAsReference: (job: ImageJobView) => void;
  onOpen: (job: ImageJobView) => void;
  onUseSample: (sample: ShowcaseItem) => void;
}) {
  const ratio = job ? jobAspect(job) : (SAMPLE_RATIO[sample.ratio] ?? 3 / 4);
  const image = loading
    ? null
    : job?.url
      ? { src: job.url, alt: job.prompt || "生成结果" }
      : {
          src: sample.large,
          srcSet: `${sample.src} 540w, ${sample.large} 900w`,
          alt: `${SAMPLE_ALT}：${sample.prompt}`,
          focus: sample.focus,
        };

  return (
    <div className="relative">
      {/* Floor: the band of light the screen stands on (desktop). */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[calc(var(--stage-h)+22px)] right-[-12vw] left-[-70vw] hidden h-48 border-t border-tint/[0.05] bg-[linear-gradient(to_bottom,rgb(var(--amb)/0.08),transparent_70%)] lg:block"
      />

      <div className="relative flex items-end lg:h-[var(--stage-h)]">
        <div
          className="relative w-[min(100%,calc(68svh*var(--r)))] lg:w-[min(calc(100%-190px),calc(var(--stage-h)*var(--r)))]"
          style={{ "--r": ratio, aspectRatio: ratio } as React.CSSProperties}
        >
          <LightScreen
            image={image}
            tilt={-14}
            pitch={1.5}
            eager
            sizes="(min-width: 1024px) 40vw, 100vw"
            className="absolute inset-0 hidden lg:block"
            frameClassName={cn(loading && "animate-breathe")}
          >
            <ScreenOverlay job={job} onOpen={onOpen} />
          </LightScreen>
          <LightScreen
            image={image}
            tilt={-6}
            pitch={1}
            interactive={false}
            reflection={false}
            sizes="100vw"
            className="absolute inset-0 lg:hidden"
            frameClassName={cn(loading && "animate-breathe")}
          >
            <ScreenOverlay job={job} onOpen={onOpen} />
          </LightScreen>
        </div>
      </div>

      <aside
        aria-label={job ? "作品信息" : "示例说明"}
        className="glass-strong relative z-10 mt-6 w-full max-w-[520px] rounded-[18px] p-4 lg:absolute lg:top-[16%] lg:right-0 lg:mt-0 lg:w-[250px]"
      >
        {loading ? (
          <div className="flex flex-col gap-3" aria-label="正在读取作品">
            <span className="h-4 w-4/5 animate-breathe rounded-full" />
            <span className="h-4 w-3/5 animate-breathe rounded-full" />
            <span className="mt-4 h-9 w-full animate-breathe rounded-[10px]" />
          </div>
        ) : job ? (
          <JobInfo
            job={job}
            modelName={modelName(job.model)}
            onReuse={() => onReuse(job)}
            onDownload={() => onDownload(job)}
            onUseAsReference={() => onUseAsReference(job)}
            onOpen={() => onOpen(job)}
          />
        ) : (
          <>
            <p className="text-[12px] font-medium text-fg-muted">示例作品</p>
            <p className="mt-1.5 text-[14px] leading-[1.7] text-fg">{sample.prompt}</p>
            <p className="mt-3 text-[12.5px] leading-relaxed text-fg-soft">
              生成的作品会出现在这里，整个页面也会换成它的光。
            </p>
            <Button variant="accent" className="mt-4 h-9 w-full rounded-[10px]" onClick={() => onUseSample(sample)}>
              <RotateCcwIcon strokeWidth={2} />
              用这段描述试试
            </Button>
          </>
        )}
      </aside>
    </div>
  );
}

function ScreenOverlay({
  job,
  onOpen,
}: {
  job: ImageJobView | null;
  onOpen: (job: ImageJobView) => void;
}) {
  if (!job) {
    return (
      <span className="glass absolute top-4 left-4 rounded-full px-3 py-1 text-[12px] font-medium text-fg">
        示例
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(job)}
      aria-label="查看大图"
      title="查看大图"
      className="glass absolute top-4 right-4 flex size-9 items-center justify-center rounded-full text-fg transition-colors hover:bg-tint/[0.16] focus-visible:outline-2 focus-visible:outline-acc"
    >
      <Maximize2Icon className="size-4" strokeWidth={1.75} />
    </button>
  );
}

function JobInfo({
  job,
  modelName,
  onReuse,
  onDownload,
  onUseAsReference,
  onOpen,
}: {
  job: ImageJobView;
  modelName: string;
  onReuse: () => void;
  onDownload: () => void;
  onUseAsReference: () => void;
  onOpen: () => void;
}) {
  return (
    <>
      <p className="line-clamp-4 text-[14px] leading-[1.7] text-fg" title={job.prompt}>
        {job.prompt || "（无描述）"}
      </p>
      <dl className="mt-3.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12.5px]">
        <dt className="text-fg-muted">模型</dt>
        <dd className="truncate text-right text-fg-soft">{modelName}</dd>
        <dt className="text-fg-muted">尺寸</dt>
        <dd className="text-right font-mono text-[12px] text-fg-soft">
          {QUALITY_LABEL[job.quality]} · {job.aspectRatio ?? "默认"}
        </dd>
        <dt className="text-fg-muted">扣费</dt>
        <dd className="text-right">
          <BillingBadge status={job.billing} active={isActiveJob(job)} />
        </dd>
        <dt className="text-fg-muted">时间</dt>
        <dd className="text-right font-mono text-[12px] text-fg-soft">
          {dayLabel(job.createdAt)} {formatTime(job.createdAt)}
        </dd>
      </dl>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="accent" className="col-span-2 h-9 rounded-[10px]" onClick={onReuse}>
          <RotateCcwIcon strokeWidth={2} />
          做同款
        </Button>
        <Button variant="outline" className="h-9 rounded-[10px]" onClick={onDownload}>
          <DownloadIcon strokeWidth={1.75} />
          下载
        </Button>
        {job.assetId ? (
          <Button variant="outline" className="h-9 rounded-[10px]" onClick={onUseAsReference}>
            <ImagePlusIcon strokeWidth={1.75} />
            作参考图
          </Button>
        ) : (
          <Button variant="outline" className="h-9 rounded-[10px]" onClick={onOpen}>
            <Maximize2Icon strokeWidth={1.75} />
            看大图
          </Button>
        )}
      </div>
    </>
  );
}

/**
 * Recent results under the screen. Picking one puts it on the screen and
 * relights the room; running and problem jobs show their state.
 */
export function RecentStrip({
  jobs,
  total,
  selectedId,
  onSelect,
  onOpen,
  className,
}: {
  jobs: ImageJobView[];
  total: number;
  selectedId: string | null;
  onSelect: (job: ImageJobView) => void;
  onOpen: (job: ImageJobView) => void;
  className?: string;
}) {
  if (jobs.length === 0) return null;
  return (
    <div className={className}>
      <div className="mb-2.5 flex items-baseline justify-between gap-4 text-[13px] text-fg-muted">
        <span>
          最近生成 · {total} 张<span className="hidden sm:inline">，点一张就换成它的光</span>
        </span>
        <a href="#history" className="inline-flex items-center gap-1 text-fg-soft transition-colors hover:text-fg">
          全部作品
          <ArrowDownIcon className="size-3.5" strokeWidth={1.75} />
        </a>
      </div>
      <div role="radiogroup" aria-label="最近生成的作品" className="-mx-1 flex items-end gap-2.5 overflow-x-auto px-1 pt-1 pb-1 scrollbar-hidden">
        {jobs.map((job) => {
          const active = isActiveJob(job);
          const done = job.status === "succeeded" && Boolean(job.url);
          const problem = !active && (isFailedJob(job) || needsReconcile(job.billing));
          const selected = done && job.id === selectedId;
          if (active) {
            return (
              <span
                key={job.id}
                role="img"
                aria-label={jobStatusLabel(job)}
                className="flex h-[72px] w-14 shrink-0 items-center justify-center rounded-[10px] bg-tint/[0.06] shadow-[0_0_0_1px_rgb(var(--amb)/0.5)]"
              >
                <svg viewBox="0 0 36 36" className="size-7 animate-spin [animation-duration:1.4s] motion-reduce:animate-none" aria-hidden>
                  <circle cx="18" cy="18" r="14" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="3" />
                  <circle
                    cx="18"
                    cy="18"
                    r="14"
                    fill="none"
                    stroke="rgb(var(--amb))"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray="40 88"
                  />
                </svg>
              </span>
            );
          }
          return (
            <button
              key={job.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={done ? `看这张：${job.prompt || "生成结果"}` : `出了问题：${job.prompt || "生成结果"}`}
              onClick={() => (done ? onSelect(job) : onOpen(job))}
              className={cn(
                "relative shrink-0 overflow-hidden rounded-[10px] transition-[width,height,opacity,box-shadow] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
                selected
                  ? "h-[84px] w-16 opacity-100 shadow-[0_0_0_2px_rgb(255_255_255/0.9),0_0_30px_-4px_rgb(var(--amb)/0.8)]"
                  : "h-[72px] w-14 opacity-60 shadow-[0_0_0_1px_rgb(255_255_255/0.1)] hover:opacity-100",
                problem && "bg-alert-wash opacity-100 shadow-[0_0_0_1px_rgb(255_138_128/0.6)]",
              )}
            >
              {done ? (
                // biome-ignore lint/performance/noImgElement: public storage URL
                <img src={job.url!} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              ) : (
                <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-alert text-[11px] leading-none font-bold text-ground-deep">
                  !
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
