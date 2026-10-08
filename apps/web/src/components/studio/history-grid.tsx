"use client";

import { DownloadIcon, Maximize2Icon, RotateCcwIcon } from "lucide-react";

import { useNow } from "@/hooks/use-now";
import { describeIssue } from "@/lib/generation-errors";
import {
  type ImageJobView,
  formatElapsed,
  groupByDay,
  isActiveJob,
  isFailedJob,
} from "@/lib/image-jobs";
import { QUALITY_LABEL } from "@/lib/image-model-meta";
import { cn } from "@/lib/utils";

import { LiveDot } from "../ambient/live-dot";
import { RevealImage } from "../ambient/reveal-image";
import { BillingBadge, needsReconcile } from "../billing/billing-badge";

/**
 * Every result, grouped by day. Clicking a finished picture puts it on the
 * screen above (and relights the room); problems open their details.
 */
export function HistoryGrid({
  jobs,
  selectedId,
  modelName,
  justFinished,
  onSelect,
  onOpen,
  onReuse,
  onCancel,
  onDownload,
}: {
  jobs: ImageJobView[];
  selectedId: string | null;
  modelName: (id: string | null) => string;
  /** Session jobs that just finished: they light up once. */
  justFinished: Set<string>;
  onSelect: (job: ImageJobView) => void;
  onOpen: (job: ImageJobView) => void;
  onReuse: (job: ImageJobView) => void;
  onCancel: (job: ImageJobView) => void;
  onDownload: (job: ImageJobView) => void;
}) {
  const days = groupByDay(jobs);
  const ticking = jobs.some(isActiveJob);
  const now = useNow(ticking);

  return (
    <div className="flex flex-col gap-12">
      {days.map((day) => (
        <section key={day.key} aria-label={`${day.label}的作品`}>
          <div className="mb-4 flex items-baseline gap-3">
            <h3 className="text-[16px] font-semibold text-fg">{day.label}</h3>
            <span className="text-[13px] text-fg-muted tabular">{day.jobs.length} 张</span>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {day.jobs.map((job) => (
              <HistoryTile
                key={job.id}
                job={job}
                now={now}
                selected={job.id === selectedId}
                modelName={modelName(job.model)}
                reveal={justFinished.has(job.id)}
                onSelect={() => onSelect(job)}
                onOpen={() => onOpen(job)}
                onReuse={() => onReuse(job)}
                onCancel={() => onCancel(job)}
                onDownload={() => onDownload(job)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function HistoryTile({
  job,
  now,
  selected,
  modelName,
  reveal,
  onSelect,
  onOpen,
  onReuse,
  onCancel,
  onDownload,
}: {
  job: ImageJobView;
  now: number;
  selected: boolean;
  modelName: string;
  reveal: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onReuse: () => void;
  onCancel: () => void;
  onDownload: () => void;
}) {
  const running = job.status === "running";
  const queued = job.status === "queued";
  const failed = isFailedJob(job);
  const done = job.status === "succeeded" && Boolean(job.url);
  const issue = failed ? describeIssue(job.errorCode ?? "upstream_unknown", job.errorMessage) : null;
  const reconcile = needsReconcile(job.billing, isActiveJob(job));
  const spec = `${modelName} · ${QUALITY_LABEL[job.quality]} · ${job.aspectRatio ?? "默认"}`;

  return (
    <li className="min-w-0">
      <div
        className={cn(
          "group relative aspect-[4/5] overflow-hidden rounded-[14px] bg-white/[0.04] shadow-[0_0_0_1px_rgb(255_255_255/0.08)] transition-[box-shadow,transform] duration-300",
          done &&
            "hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgb(255_255_255/0.2),0_30px_60px_-30px_rgb(2_4_10/0.9),0_0_50px_-14px_rgb(var(--amb)/0.6)]",
          selected && "shadow-[0_0_0_2px_rgb(255_255_255/0.85),0_0_40px_-10px_rgb(var(--amb)/0.8)]",
          reconcile && !done && "shadow-[0_0_0_1px_rgb(255_138_128/0.45)]",
        )}
      >
        {done ? (
          <>
            <button
              type="button"
              onClick={onSelect}
              aria-pressed={selected}
              aria-label={`放到屏幕上：${job.prompt || "生成结果"}`}
              className="absolute inset-0 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amb"
            >
              <RevealImage
                src={job.url!}
                alt={job.prompt || "生成结果"}
                reveal={reveal}
                className="absolute inset-0"
                imgClassName="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
              />
            </button>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,rgb(6_9_18/0.9),rgb(6_9_18/0.5)_55%,transparent)] px-3 pt-12 pb-3 opacity-0 transition-opacity duration-300 group-focus-within:opacity-100 group-hover:opacity-100">
              <p className="line-clamp-2 text-[12.5px] leading-snug text-fg">{job.prompt}</p>
              <div className="mt-2.5 flex gap-1.5">
                <TileAction label="做同款" onClick={onReuse}>
                  <RotateCcwIcon />
                </TileAction>
                <TileAction label="下载" onClick={onDownload}>
                  <DownloadIcon />
                </TileAction>
                <TileAction label="查看大图" onClick={onOpen}>
                  <Maximize2Icon />
                </TileAction>
              </div>
            </div>
          </>
        ) : running ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <span className="absolute inset-0 animate-sweep bg-[linear-gradient(100deg,transparent,rgb(var(--amb)/0.12),transparent)]" />
            </span>
            <span className="relative flex items-center gap-2 text-[13px] font-medium text-fg">
              <LiveDot />
              生成中
            </span>
            <span className="relative font-mono text-[12px] text-fg-muted tabular">
              {formatElapsed(job.startedAt ?? job.createdAt, now)}
            </span>
            <span className="relative max-w-[14em] text-[11.5px] leading-snug text-fg-muted">
              请求已发往主站，慢的模型要几分钟
            </span>
          </div>
        ) : queued ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 rounded-[14px] border border-dashed border-line-strong p-4 text-center">
            <span className="text-[13px] font-medium text-fg-soft">排队中</span>
            <span className="font-mono text-[12px] text-fg-muted tabular">
              {formatElapsed(job.createdAt, now)}
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-2 py-1 text-[12px] text-fg-soft underline underline-offset-4 hover:text-fg"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="absolute inset-0 flex flex-col items-start justify-end gap-1 p-3.5 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amb"
          >
            <span className="text-[13px] font-semibold text-fg">
              {failed ? issue?.title : job.status === "canceled" ? "已取消" : "没有图片"}
            </span>
            {failed ? (
              <span className="line-clamp-2 text-[11.5px] leading-snug text-fg-soft">
                {issue?.maybeCharged || reconcile ? "可能已扣费，点开核对" : issue?.message}
              </span>
            ) : null}
          </button>
        )}
        {reconcile && !done ? (
          <span className="absolute top-2.5 left-2.5">
            <BillingBadge status={job.billing} />
          </span>
        ) : null}
      </div>
      <p className="mt-2 flex min-w-0 items-center gap-2 text-[12px] text-fg-muted">
        <span className="min-w-0 truncate">{spec}</span>
        {failed && job.billing === "not_charged" ? <span className="ml-auto shrink-0">未扣费</span> : null}
      </p>
    </li>
  );
}

function TileAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="pointer-events-auto flex size-8 items-center justify-center rounded-[9px] bg-white/[0.14] text-fg backdrop-blur-md transition-colors hover:bg-white/[0.24] [&_svg]:size-4 [&_svg]:stroke-[1.75]"
    >
      {children}
    </button>
  );
}
