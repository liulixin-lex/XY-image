/**
 * 最近生成 (第 56 条): pictures grouped by the day they were made.
 */
import type { ImageJobView } from "./image-jobs";

/** 今天 / 昨天 / 10月8日 周三 (with the year when it is not this year). */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  const weekday = "日一二三四五六"[date.getDay()];
  const day = `${date.getMonth() + 1}月${date.getDate()}日 周${weekday}`;
  return date.getFullYear() === now.getFullYear() ? day : `${date.getFullYear()}年${day}`;
}

/** Consecutive pictures of the same day, newest day first. */
export function groupByDay<T extends Pick<ImageJobView, "createdAt">>(items: readonly T[], now = new Date()) {
  const groups: { label: string; jobs: T[] }[] = [];
  for (const job of items) {
    const label = dayLabel(job.createdAt, now);
    const last = groups.at(-1);
    if (last?.label === label) last.jobs.push(job);
    else groups.push({ label, jobs: [job] });
  }
  return groups;
}

