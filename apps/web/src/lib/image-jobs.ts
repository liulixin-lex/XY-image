/**
 * Typed views over background_jobs rows of type `image_generation`.
 * The API returns payload/result as loose records; read them defensively.
 */
import type { BackgroundJob } from "@loomic/shared";

import type { BillingStatus } from "@/components/billing/billing-badge";

export type ImageJobView = {
  id: string;
  status: BackgroundJob["status"];
  billing: BillingStatus;
  requestId: string | null;
  prompt: string;
  model: string | null;
  quality: "standard" | "hd";
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
  return {
    id: job.id,
    status: job.status,
    billing: (job.billing_status ?? "none") as BillingStatus,
    requestId: job.xy2api_request_id ?? null,
    prompt: str(payload.prompt) ?? "",
    model: str(payload.model),
    quality: payload.quality === "hd" ? "hd" : "standard",
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
  };
}

export function isActiveJob(job: Pick<ImageJobView, "status">) {
  return job.status === "queued" || job.status === "running";
}

export function isFailedJob(job: Pick<ImageJobView, "status">) {
  return job.status === "failed" || job.status === "dead_letter";
}

export const STATUS_LABEL: Record<ImageJobView["status"], string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  dead_letter: "失败",
  canceled: "已取消",
};

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
