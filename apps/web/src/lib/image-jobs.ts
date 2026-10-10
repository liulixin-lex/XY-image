/**
 * Typed views over background_jobs rows of type `image_generation`.
 * The API returns payload/result as loose records; read them defensively.
 */
import {
  type BackgroundJob,
  type ImageQuality,
  type ImageResolution,
  isLegacyImageQuality,
  normalizeImageParams,
} from "@loomic/shared";

import {
  type BillingStatus,
  isBillingSettled,
  needsReconcile,
} from "@/components/billing/billing-badge";
import { describeIssue } from "@/lib/generation-errors";

export type ImageJobView = {
  id: string;
  status: BackgroundJob["status"];
  billing: BillingStatus;
  requestId: string | null;
  prompt: string;
  model: string | null;
  /** 画质 asked for (older jobs: read from their single quality field). */
  resolution: ImageResolution;
  /** 质量 asked for; null for jobs from before the setting existed. */
  quality: ImageQuality | null;
  aspectRatio: string | null;
  inputImages: string[];
  url: string | null;
  assetId: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Studio batch this picture belongs to (null for single jobs and agent images). */
  batchId: string | null;
  /** 0-based position in its batch. */
  batchIndex: number;
  /** Pictures asked for in its batch (1 for single jobs). */
  batchSize: number;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function toImageJobView(job: BackgroundJob): ImageJobView {
  const payload = job.payload ?? {};
  const result = job.result ?? {};
  const params = normalizeImageParams(payload);
  // Old jobs only had standard / hd (= 1K / 2K) and chose no 质量 themselves.
  const legacy = payload.resolution === undefined && isLegacyImageQuality(payload.quality);
  return {
    id: job.id,
    status: job.status,
    billing: (job.billing_status ?? "none") as BillingStatus,
    requestId: job.xy2api_request_id ?? null,
    prompt: str(payload.prompt) ?? "",
    model: str(payload.model),
    resolution: params.resolution,
    quality: legacy ? null : params.quality,
    aspectRatio: str(payload.aspect_ratio),
    inputImages: Array.isArray(payload.input_images)
      ? payload.input_images.filter((v): v is string => typeof v === "string")
      : [],
    url: str(result.signed_url) ?? str(result.url),
    assetId: str(result.asset_id),
    width: num(result.width),
    height: num(result.height),
    mimeType: str(result.mime_type),
    errorCode: job.error_code,
    errorMessage: job.error_message,
    createdAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    batchId: str(payload.batch_id),
    batchIndex: num(payload.batch_index) ?? 0,
    batchSize: num(payload.batch_size) ?? 1,
  };
}

export function isActiveJob(job: Pick<ImageJobView, "status">) {
  return job.status === "queued" || job.status === "running";
}

export function isFailedJob(job: Pick<ImageJobView, "status">) {
  return job.status === "failed" || job.status === "dead_letter";
}

/**
 * Charged, but storage refused the image; the server keeps it and retries
 * the upload (server M6). Still active, but no longer uses a generation slot
 * and can no longer be canceled.
 */
export function isSavingJob(job: Pick<ImageJobView, "status" | "errorCode">) {
  return isActiveJob(job) && job.errorCode === "storage_retrying";
}

/** STATUS_LABEL, with 保存中 for a job waiting for a storage retry. */
export function jobStatusLabel(job: Pick<ImageJobView, "status" | "errorCode">) {
  return isSavingJob(job) ? "保存中" : STATUS_LABEL[job.status];
}

export const STATUS_LABEL: Record<ImageJobView["status"], string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  dead_letter: "失败",
  canceled: "已取消",
};

/**
 * Not sent to the main site yet: queued with nothing charged. The worker's
 * dispatch gate holds these while two of the user's requests are out, so
 * they can still be canceled for free.
 */
export function isUnsentJob(job: Pick<ImageJobView, "status" | "billing" | "errorCode">) {
  return job.status === "queued" && job.billing === "none" && job.errorCode !== "storage_retrying";
}

/**
 * One studio request: the pictures of a batch in order, or a single job
 * (agent images, older jobs) on its own. Keeps the newest-first order of
 * the job list.
 */
export type JobGroup = {
  key: string;
  batchId: string | null;
  jobs: ImageJobView[];
  /** Pictures asked for; can exceed jobs.length if submission stopped part way or older ones fell off the list. */
  size: number;
  lead: ImageJobView;
};

export function groupByBatch(jobs: ImageJobView[]): JobGroup[] {
  const groups = new Map<string, JobGroup>();
  for (const job of jobs) {
    const key = job.batchId ?? job.id;
    const group = groups.get(key);
    if (group) group.jobs.push(job);
    else
      groups.set(key, {
        key,
        batchId: job.batchId,
        jobs: [job],
        size: job.batchId ? job.batchSize : 1,
        lead: job,
      });
  }
  for (const group of groups.values()) {
    group.jobs.sort((a, b) => a.batchIndex - b.batchIndex);
    group.lead = group.jobs[0] ?? group.lead;
  }
  return [...groups.values()];
}

/**
 * What a settled-or-not job means for the user, in words (billing is never
 * told by colour alone). Shared by the studio cards and their tests.
 */
export type JobOutcome = {
  tone: "running" | "queued" | "saving" | "done" | "unknown" | "not_charged" | "charged_failed" | "failed" | "canceled";
  title: string;
};

export function describeOutcome(job: ImageJobView): JobOutcome {
  if (isSavingJob(job)) return { tone: "saving", title: "图片已生成，正在保存" };
  if (job.status === "running") return { tone: "running", title: "生成中" };
  if (job.status === "queued") return { tone: "queued", title: "排队中" };
  // Canceled before the dispatch: nothing reached the main site.
  if (job.status === "canceled" && job.billing === "none")
    return { tone: "canceled", title: "已取消，没有发出" };
  if (job.status === "succeeded" && !needsReconcile(job.billing))
    return { tone: "done", title: "已完成" };
  const issue = isFailedJob(job)
    ? describeIssue(job.errorCode ?? "upstream_unknown", job.errorMessage)
    : null;
  if (needsReconcile(job.billing) || (issue?.maybeCharged && !isBillingSettled(job.billing)))
    return { tone: "unknown", title: "结果未知，可能已扣费" };
  if (job.billing === "not_charged") return { tone: "not_charged", title: "没生成出来，这次没有扣费" };
  if (job.billing === "charged") return { tone: "charged_failed", title: "主站已扣费，但没拿到图片" };
  return { tone: "failed", title: issue?.title ?? "生成失败" };
}

/** One local calendar day of results, newest first. */
export type DayGroup = { key: string; label: string; jobs: ImageJobView[] };

export function groupByDay(jobs: ImageJobView[], now = new Date()): DayGroup[] {
  const days = new Map<string, DayGroup>();
  for (const job of jobs) {
    const key = dayKey(new Date(job.createdAt));
    let day = days.get(key);
    if (!day) {
      day = { key, label: dayLabel(job.createdAt, now), jobs: [] };
      days.set(key, day);
    }
    day.jobs.push(job);
  }
  return [...days.values()];
}

/** 今天 / 昨天 / 10月6日 */
export function dayLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const key = dayKey(date);
  if (key === dayKey(now)) return "今天";
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return "昨天";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Width / height of a result, from its pixels or its requested ratio. */
export function jobAspect(job: Pick<ImageJobView, "width" | "height" | "aspectRatio">) {
  if (job.width && job.height) return job.width / job.height;
  const [w, h] = (job.aspectRatio ?? "1:1").split(":").map(Number);
  return w && h ? w / h : 1;
}

export function formatElapsed(fromIso: string | null, now = Date.now()) {
  if (!fromIso) return "00:00";
  const seconds = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatTime(iso: string) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** File name for downloads: gguu-<date>-<id8>.<ext> */
export function downloadName(job: ImageJobView) {
  const ext =
    job.mimeType === "image/jpeg" ? "jpg" : job.mimeType === "image/webp" ? "webp" : "png";
  return `gguu-${job.createdAt.slice(0, 10)}-${job.id.slice(0, 8)}.${ext}`;
}
