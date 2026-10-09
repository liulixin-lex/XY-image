"use client";

import {
  ArrowUpRightIcon,
  CircleAlertIcon,
  CircleXIcon,
  PencilLineIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useNow } from "@/hooks/use-now";
import { describeIssue } from "@/lib/generation-errors";
import { type ImageJobView, formatElapsed, isActiveJob, isFailedJob, isSavingJob } from "@/lib/image-jobs";
import { cn } from "@/lib/utils";

import { needsReconcile } from "../billing/billing-badge";

const DISMISSED_KEY = "xy:studio-dismissed";
const ATTENTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ATTENTION = 3;

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * 正在处理: jobs still running or queued, plus recent ones that need the
 * user (failed, or billed with an unknown result). Problem rows can be
 * dismissed; they stay in the history either way.
 */
export function JobQueue({
  jobs,
  usageUrl,
  onCancel,
  onReuse,
  onOpen,
  empty,
  className,
}: {
  jobs: ImageJobView[];
  usageUrl: string | null;
  onCancel: (job: ImageJobView) => void;
  onReuse: (job: ImageJobView) => void;
  onOpen: (job: ImageJobView) => void;
  /** Shown when nothing is in progress. */
  empty?: React.ReactNode;
  className?: string;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  useEffect(() => setDismissed(readDismissed()), []);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      try {
        // Keep the newest 200 ids; older jobs fall out of the window anyway.
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-200)));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const rows = useMemo(() => {
    const active = jobs.filter(isActiveJob).reverse();
    const since = Date.now() - ATTENTION_WINDOW_MS;
    const attention = jobs
      .filter(
        (job) =>
          !isActiveJob(job) &&
          !dismissed.has(job.id) &&
          new Date(job.createdAt).getTime() > since &&
          (isFailedJob(job) || needsReconcile(job.billing)),
      )
      .slice(0, MAX_ATTENTION);
    return [...active, ...attention];
  }, [jobs, dismissed]);

  const ticking = rows.some(isActiveJob);
  const now = useNow(ticking);

  return (
    <section aria-labelledby="queue-title" className={className}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="queue-title" className="text-[15px] font-bold text-fg">
          {rows.length ? "正在处理" : "可以这样写"}
        </h2>
        {rows.length ? <span className="text-[13px] text-fg-muted">按次从主站余额扣费</span> : null}
      </div>
      {rows.length ? (
        <ul className="flex flex-col gap-2.5">
          {rows.map((job) => (
            <QueueRow
              key={job.id}
              job={job}
              now={now}
              usageUrl={usageUrl}
              onCancel={() => onCancel(job)}
              onReuse={() => onReuse(job)}
              onOpen={() => onOpen(job)}
              onDismiss={() => dismiss(job.id)}
            />
          ))}
        </ul>
      ) : (
        empty
      )}
    </section>
  );
}

const actionClass =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border border-line-strong bg-white/[0.05] px-3 text-[13px] font-medium whitespace-nowrap text-fg transition-colors hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amb [&_svg]:size-3.5";

function QueueRow({
  job,
  now,
  usageUrl,
  onCancel,
  onReuse,
  onOpen,
  onDismiss,
}: {
  job: ImageJobView;
  now: number;
  usageUrl: string | null;
  onCancel: () => void;
  onReuse: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const saving = isSavingJob(job);
  const running = job.status === "running" && !saving;
  const queued = job.status === "queued" && !saving;
  const failed = isFailedJob(job);
  const issue = failed ? describeIssue(job.errorCode ?? "upstream_unknown", job.errorMessage) : null;
  const settled = !running && !queued && !saving;
  const unknown = settled && (needsReconcile(job.billing) || Boolean(issue?.maybeCharged));
  const prompt = job.prompt || "（无描述）";

  let title: string;
  let detail: string;
  if (running) {
    title = "生成中";
    detail = prompt;
  } else if (queued) {
    title = "排队中";
    detail = prompt;
  } else if (saving) {
    title = "图片已生成，正在保存";
    detail = "已经扣费，存好后会出现在这里，不用重新提交";
  } else if (unknown) {
    title = "结果未知，可能已扣费";
    detail = job.requestId
      ? `${issue?.title ?? "没拿到结果"} · 请求 ID ${shortId(job.requestId)}`
      : (issue?.title ?? "没拿到结果");
  } else if (job.billing === "not_charged") {
    title = "没生成出来，这次没有扣费";
    detail = issue?.title ? `${issue.title} · ${prompt}` : prompt;
  } else {
    title = issue?.title ?? "生成失败";
    detail = issue?.message ?? prompt;
  }

  return (
    <li
      className={cn(
        "glass relative flex flex-wrap items-center gap-x-3.5 gap-y-2 overflow-hidden rounded-[16px] py-3 pr-3.5 pl-3 sm:flex-nowrap",
        running &&
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_0_0_1px_rgb(var(--amb)/0.3),0_0_40px_-16px_rgb(var(--amb)/0.7)]",
        unknown && "border-alert/35",
      )}
    >
      {running ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="absolute inset-0 animate-sweep bg-[linear-gradient(100deg,transparent,rgb(255_255_255/0.07),transparent)]" />
        </span>
      ) : null}

      <span
        aria-hidden
        className={cn(
          "relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px]",
          running && "bg-[radial-gradient(circle_at_30%_30%,rgb(var(--amb)/0.55),rgb(var(--amb-2)/0.35)_55%,rgb(255_255_255/0.04))] animate-breathe",
          (queued || saving) && "border border-dashed border-line-strong",
          settled && (unknown ? "bg-alert-wash text-alert" : "bg-white/[0.06] text-fg-soft"),
        )}
      >
        {settled ? (
          unknown ? (
            <CircleAlertIcon className="size-5" strokeWidth={1.75} />
          ) : (
            <CircleXIcon className="size-5" strokeWidth={1.75} />
          )
        ) : null}
      </span>

      <div className="relative min-w-0 flex-1">
        <p className={cn("flex items-center gap-2 text-[14px] font-semibold", unknown ? "text-alert" : "text-fg")}>
          {running ? (
            <span className="size-2 shrink-0 rounded-full bg-amb shadow-[0_0_0_4px_rgb(var(--amb)/0.2),0_0_12px_rgb(var(--amb))]" />
          ) : null}
          {title}
        </p>
        <p className="mt-0.5 truncate text-[13px] text-fg-soft" title={detail}>
          {detail}
        </p>
      </div>

      {running || queued ? (
        <span className="relative shrink-0 font-mono text-[18px] tracking-[-0.02em] text-fg tabular sm:text-[20px]">
          {formatElapsed(running ? (job.startedAt ?? job.createdAt) : job.createdAt, now)}
        </span>
      ) : null}
      {queued ? (
        <button type="button" onClick={onCancel} className={actionClass}>
          取消
        </button>
      ) : null}
      {settled ? (
        // Phones: actions drop to a second line, aligned under the text.
        <div className="relative flex w-full items-center justify-end gap-1 pl-[62px] sm:w-auto sm:pl-0">
          {unknown ? (
            usageUrl ? (
              <a href={usageUrl} target="_blank" rel="noreferrer" className={actionClass}>
                去主站核对
                <ArrowUpRightIcon strokeWidth={2} />
              </a>
            ) : (
              <button type="button" onClick={onOpen} className={actionClass}>
                查看详情
              </button>
            )
          ) : (
            <button type="button" onClick={onReuse} className={actionClass}>
              <PencilLineIcon strokeWidth={1.75} />
              改一改再试
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="从这里移除"
            title="从这里移除（历史里还在）"
            className="-mr-1 ml-1 flex size-8 shrink-0 items-center justify-center rounded-[9px] text-fg-muted transition-colors hover:bg-white/[0.08] hover:text-fg"
          >
            <XIcon className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
    </li>
  );
}

function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
}
