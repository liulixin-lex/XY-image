"use client";

import {
  ArrowUpRightIcon,
  BrushIcon,
  CircleAlertIcon,
  DownloadIcon,
  ExpandIcon,
  ImagePlusIcon,
  Maximize2Icon,
  PencilLineIcon,
  ShuffleIcon,
  XIcon,
} from "lucide-react";

import { useNow } from "@/hooks/use-now";
import { describeIssue } from "@/lib/generation-errors";
import {
  type ImageJobView,
  type JobGroup,
  describeOutcome,
  formatElapsed,
  formatTime,
  isActiveJob,
  isFailedJob,
  isUnsentJob,
  jobAspect,
  listImage,
} from "@/lib/image-jobs";
import { describeImageParams } from "@/lib/image-model-meta";
import { IMAGE_EDIT_LABEL, type ImageEditMode } from "@/lib/mask-edit";
import { cn } from "@/lib/utils";

import { RevealImage } from "../ambient/reveal-image";
import { BillingBadge } from "../billing/billing-badge";

export type FeedActions = {
  onSelect: (job: ImageJobView) => void;
  onOpen: (job: ImageJobView) => void;
  /** 以此为参考: add the picture to the references, keep the current text. */
  onReference: (job: ImageJobView) => void;
  /** 变体: this picture's text and settings, with the picture as a reference. Nothing is sent. */
  onVariant: (job: ImageJobView) => void;
  onDownload: (job: ImageJobView) => void;
  /** Put a failed job's text and settings back into the composer. */
  onReuse: (job: ImageJobView) => void;
  onCancelJob: (job: ImageJobView) => void;
  onCancelBatch: (batchId: string) => void;
  /**
   * 局部重绘 / 扩图: opens the editor (nothing is sent until it is
   * submitted). Absent when no model on the key can do it.
   */
  onEdit?: (job: ImageJobView, mode: ImageEditMode) => void;
};

/** Anchor id of a group, for the 记录 rail. */
export function groupAnchor(key: string) {
  return `req-${key}`;
}

/**
 * The studio feed: one block per request (a batch of 1 to 4 pictures),
 * newest first. Each picture is numbered, carries its billing state in
 * words and its request id; the selected one gets the toolbar.
 *
 * 局部重绘 / 扩图 (M-G) open the editor from the toolbar.
 * TODO(agent01): 放到画布 (send a picture to a node canvas) could join the
 * toolbar later.
 */
export function BatchFeed({
  groups,
  selectedId,
  justFinished,
  modelName,
  usageUrl,
  actions,
}: {
  groups: JobGroup[];
  selectedId: string | null;
  justFinished: Set<string>;
  modelName: (id: string | null) => string;
  usageUrl: string | null;
  actions: FeedActions;
}) {
  return (
    // Columns follow the feed's own width (it shares the row with two panels).
    <div className="@container flex flex-col gap-14">
      {groups.map((group) => (
        <BatchBlock
          key={group.key}
          group={group}
          selectedId={selectedId}
          justFinished={justFinished}
          modelName={modelName}
          usageUrl={usageUrl}
          actions={actions}
        />
      ))}
    </div>
  );
}

function BatchBlock({
  group,
  selectedId,
  justFinished,
  modelName,
  usageUrl,
  actions,
}: {
  group: JobGroup;
  selectedId: string | null;
  justFinished: Set<string>;
  modelName: (id: string | null) => string;
  usageUrl: string | null;
  actions: FeedActions;
}) {
  const { lead, jobs } = group;
  const done = jobs.filter((job) => job.status === "succeeded").length;
  const toCheck = jobs.filter((job) => describeOutcome(job).tone === "unknown").length;
  const unsent = jobs.filter(isUnsentJob);
  const active = jobs.some(isActiveJob);
  const titleId = `${groupAnchor(group.key)}-title`;
  const meta = [
    lead.edit ? IMAGE_EDIT_LABEL[lead.edit] : null,
    lead.aspectRatio ?? "默认比例",
    describeImageParams({ resolution: lead.resolution, quality: lead.quality }),
    `${group.size} 张`,
    modelName(lead.model),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section id={groupAnchor(group.key)} aria-labelledby={titleId} className="scroll-mt-28">
      <header className="mb-4 flex flex-col gap-x-6 gap-y-2.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-[52em] flex-1">
          <h3 id={titleId} className="line-clamp-2 font-display text-[20px] leading-[1.35] font-normal text-fg">
            {lead.prompt || "（无描述）"}
          </h3>
          <p className="mt-1.5 data-label text-[12px] text-fg-muted">{meta}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {unsent.length > 0 && group.batchId && unsent.length > 1 ? (
            <button
              type="button"
              onClick={() => actions.onCancelBatch(group.batchId!)}
              className="inline-flex h-7 items-center gap-1 rounded-[8px] px-2.5 text-[12.5px] font-semibold text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
            >
              <XIcon className="size-3.5" strokeWidth={2.2} />
              取消没发出的 {unsent.length} 张
            </button>
          ) : null}
          <span
            className={cn(
              "inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-semibold tabular",
              active
                ? "bg-acc-soft text-acc-text"
                : toCheck
                  ? "bg-warn-wash text-warn"
                  : done
                    ? "bg-ok-wash text-ok"
                    : "bg-tint/[0.07] text-fg-soft",
            )}
          >
            {[
              active || toCheck || done < group.size
                ? `已完成 ${done}/${group.size}`
                : formatWhen(lead.createdAt),
              toCheck ? `待核对 ${toCheck} 张` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </header>

      <ol className="grid grid-cols-2 gap-x-3 gap-y-5 sm:gap-x-4 @min-[560px]:grid-cols-3 @min-[800px]:grid-cols-4">
        {jobs.map((job) => (
          <li key={job.id} className="min-w-0">
            <PictureCard
              job={job}
              index={group.batchId ? job.batchIndex : 0}
              selected={job.id === selectedId}
              reveal={justFinished.has(job.id)}
              usageUrl={usageUrl}
              actions={actions}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function PictureCard({
  job,
  index,
  selected,
  reveal,
  usageUrl,
  actions,
}: {
  job: ImageJobView;
  index: number;
  selected: boolean;
  reveal: boolean;
  usageUrl: string | null;
  actions: FeedActions;
}) {
  const outcome = describeOutcome(job);
  const number = String(index + 1).padStart(2, "0");
  const aspect = jobAspect(job);
  const hasImage = job.status === "succeeded" && Boolean(job.url);

  return (
    <figure className="group/card @container/card m-0">
      <div
        className={cn(
          "relative overflow-hidden rounded-[14px] transition-shadow duration-300",
          selected ? "ring-picked" : hasImage ? "shadow-card hover:shadow-card-hover" : "",
        )}
        style={{ aspectRatio: aspect }}
      >
        {hasImage && job.url ? (
          <>
            <button
              type="button"
              onClick={() => actions.onSelect(job)}
              onDoubleClick={() => actions.onOpen(job)}
              aria-pressed={selected}
              aria-label={`第 ${index + 1} 张${selected ? "（已选中）" : ""}：${job.prompt}`}
              className="absolute inset-0 block focus-visible:outline-none"
            >
              <RevealImage src={listImage(job) ?? job.url} alt="" reveal={reveal} className="h-full w-full" />
            </button>
            <Toolbar job={job} selected={selected} actions={actions} />
          </>
        ) : (
          <Placeholder job={job} outcome={outcome} usageUrl={usageUrl} actions={actions} />
        )}
      </div>
      <figcaption className="mt-2.5 flex items-center gap-2">
        <span className="numeral text-[24px] text-fg">{number}</span>
        {isActiveJob(job) ? (
          <span
            className={cn(
              "inline-flex h-[22px] shrink-0 items-center rounded-[7px] px-2 text-[11.5px] font-semibold leading-none whitespace-nowrap",
              outcome.tone === "running" ? "bg-acc-soft text-acc-text" : "bg-tint/[0.07] text-fg-soft",
            )}
          >
            {outcome.tone === "running" ? "生成中" : outcome.tone === "saving" ? "保存中" : "排队中"}
          </span>
        ) : (
          <BillingBadge status={job.billing} />
        )}
        {job.requestId ? (
          <span className="ml-auto truncate data-label text-fg-muted" title={`请求 ID ${job.requestId}`}>
            {shortId(job.requestId)}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

const toolClass =
  "inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white [&_svg]:size-[15px]";

/**
 * Actions on a finished picture: always on the selected one, on hover or
 * keyboard focus for the others (fine pointers). Nothing here sends a
 * request; 变体 and 以此为参考 only fill the composer.
 */
function Toolbar({
  job,
  selected,
  actions,
}: {
  job: ImageJobView;
  selected: boolean;
  actions: FeedActions;
}) {
  return (
    <div
      className={cn(
        "absolute inset-x-2 bottom-2 flex flex-wrap items-center gap-1 rounded-[13px] bg-[rgb(28_24_32/0.72)] p-1.5 text-white shadow-[0_10px_30px_-12px_rgb(0_0_0/0.5)] backdrop-blur-md transition-opacity duration-200",
        selected
          ? "opacity-100"
          : "pointer-events-none opacity-0 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 pointer-fine:group-hover/card:pointer-events-auto pointer-fine:group-hover/card:opacity-100",
      )}
    >
      {job.assetId ? (
        <button type="button" onClick={() => actions.onReference(job)} className={cn(toolClass, "bg-acc text-acc-ink hover:bg-acc-hover")}>
          <ImagePlusIcon strokeWidth={1.8} />
          以此为参考
        </button>
      ) : null}
      {job.assetId ? (
        <button
          type="button"
          onClick={() => actions.onVariant(job)}
          title="变体：用它的描述和设置，并把它作为参考图"
          className={cn(toolClass, "hover:bg-white/15 @max-[260px]/card:w-8 @max-[260px]/card:justify-center @max-[260px]/card:px-0")}
        >
          <ShuffleIcon strokeWidth={1.8} />
          <span className="@max-[260px]/card:sr-only">变体</span>
        </button>
      ) : null}
      <span className="ml-auto flex items-center gap-0.5">
        {actions.onEdit && job.assetId ? (
          <>
            <button
              type="button"
              onClick={() => actions.onEdit?.(job, "inpaint")}
              aria-label="局部重绘"
              title="局部重绘：涂出要改的地方"
              className={cn(toolClass, "w-8 justify-center px-0 hover:bg-white/15")}
            >
              <BrushIcon strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => actions.onEdit?.(job, "outpaint")}
              aria-label="扩图"
              title="扩图：把画面往外扩"
              className={cn(toolClass, "w-8 justify-center px-0 hover:bg-white/15")}
            >
              <ExpandIcon strokeWidth={1.8} />
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => actions.onOpen(job)}
          aria-label="查看大图和详情"
          title="查看大图和详情"
          className={cn(toolClass, "w-8 justify-center px-0 hover:bg-white/15")}
        >
          <Maximize2Icon strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => actions.onDownload(job)}
          aria-label="下载"
          title="下载"
          className={cn(toolClass, "w-8 justify-center px-0 hover:bg-white/15")}
        >
          <DownloadIcon strokeWidth={1.8} />
        </button>
      </span>
    </div>
  );
}

/**
 * A running job's timer. It reads the shared one-second clock itself, so a
 * tick re-renders this text only, not the feed and its pictures.
 */
function Elapsed({ since }: { since: string | null }) {
  const now = useNow(true);
  return <>{formatElapsed(since, now)}</>;
}

/** Everything that is not a finished picture: running, waiting, saving, failed, canceled. */
function Placeholder({
  job,
  outcome,
  usageUrl,
  actions,
}: {
  job: ImageJobView;
  outcome: ReturnType<typeof describeOutcome>;
  usageUrl: string | null;
  actions: FeedActions;
}) {
  const issue = isFailedJob(job) ? describeIssue(job.errorCode ?? "upstream_unknown", job.errorMessage) : null;

  if (outcome.tone === "running") {
    return (
      <div
        role="status"
        className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[repeating-linear-gradient(135deg,var(--acc-soft)_0_14px,transparent_14px_28px)] px-4 text-center"
      >
        <span className="numeral text-[clamp(38px,4.2vw,64px)] text-fg tabular"><Elapsed since={job.startedAt ?? job.createdAt} /></span>
        <span className="font-display text-[18px] text-fg">生成中</span>
        <span className="text-[12px] text-fg-soft">已发出，不会自动重发</span>
        <span aria-hidden className="mt-3 h-1 w-[min(70%,180px)] overflow-hidden rounded-full bg-tint/[0.1]">
          <span className="block h-full w-2/5 animate-progress rounded-full bg-acc" />
        </span>
      </div>
    );
  }

  if (outcome.tone === "queued") {
    return (
      <div
        role="status"
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-strong bg-tint/[0.03] px-4 text-center"
      >
        <span className="font-display text-[18px] text-fg">排队中</span>
        <span className="text-[12px] leading-relaxed text-fg-soft">还没发出，前面的完成后再发</span>
        <button
          type="button"
          onClick={() => actions.onCancelJob(job)}
          className="mt-1 inline-flex h-8 items-center gap-1 rounded-[9px] bg-tint/[0.07] px-3 text-[12.5px] font-semibold text-fg transition-colors hover:bg-tint/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
        >
          <XIcon className="size-3.5" strokeWidth={2.2} />
          取消这张
        </button>
      </div>
    );
  }

  if (outcome.tone === "saving") {
    return (
      <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-ok-wash px-4 text-center">
        <span className="font-display text-[17px] text-fg">{outcome.title}</span>
        <span className="text-[12px] leading-relaxed text-fg-soft">已经生成好了，存好后会出现在这里，不用重新提交</span>
      </div>
    );
  }

  const unknown = outcome.tone === "unknown";
  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center",
        unknown ? "bg-warn-wash" : "bg-tint/[0.05]",
      )}
    >
      {outcome.tone !== "canceled" ? (
        <CircleAlertIcon className={cn("size-6", unknown ? "text-warn" : "text-fg-muted")} strokeWidth={1.75} />
      ) : null}
      <span className={cn("text-[14px] leading-snug font-semibold", unknown ? "text-warn" : "text-fg")}>
        {outcome.title}
      </span>
      {issue && outcome.tone !== "failed" ? (
        <span className="text-[12px] leading-relaxed text-fg-soft">{issue.title}</span>
      ) : null}
      <span className="mt-1 flex flex-wrap justify-center gap-1.5">
        {unknown && usageUrl ? (
          <a
            href={usageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-[9px] bg-warn px-3 text-[12.5px] font-semibold text-ground transition-opacity hover:opacity-90"
          >
            去主站核对
            <ArrowUpRightIcon className="size-3.5" />
          </a>
        ) : null}
        {outcome.tone !== "canceled" ? (
          <button
            type="button"
            onClick={() => actions.onOpen(job)}
            className="inline-flex h-8 items-center rounded-[9px] bg-tint/[0.07] px-3 text-[12.5px] font-semibold text-fg transition-colors hover:bg-tint/[0.12]"
          >
            详情
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => actions.onReuse(job)}
          className="inline-flex h-8 items-center gap-1 rounded-[9px] bg-tint/[0.07] px-3 text-[12.5px] font-semibold text-fg transition-colors hover:bg-tint/[0.12]"
        >
          <PencilLineIcon className="size-3.5" strokeWidth={1.9} />
          改了再试
        </button>
      </span>
    </div>
  );
}

function shortId(id: string) {
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}

/** 今天 21:40 / 10 月 9 日 21:40 */
function formatWhen(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `今天 ${formatTime(iso)}`
    : `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${formatTime(iso)}`;
}
