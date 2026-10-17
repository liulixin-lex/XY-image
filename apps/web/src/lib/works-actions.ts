"use client";

/**
 * Batch actions on pictures for 作品 and 生成记录 (第 58 条): download as one
 * ZIP, and delete with 撤销. Nothing here generates anything.
 */
import { useCallback, useRef } from "react";

import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth-context";
import { downloadImage } from "@/lib/download";
import { readImageBlob } from "@/lib/image-blob";
import { type ImageJobView, downloadName } from "@/lib/image-jobs";
import { deleteJobs, restoreJobs } from "@/lib/server-api";
import { ZIP_MAX_ENTRIES, createZip, uniqueNames } from "@/lib/zip";

const FETCH_CONCURRENCY = 4;

function stamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export type ZipOutcome = { saved: number; failed: number };

/**
 * One picture downloads as itself; several as `作品-<time>-<n>张.zip` with
 * the originals (not the thumbnails). A picture that will not load is left
 * out and counted, the rest still download.
 */
export async function downloadJobs(
  jobs: ImageJobView[],
  onProgress?: (done: number, total: number) => void,
): Promise<ZipOutcome> {
  const list = jobs.filter((job) => job.url).slice(0, ZIP_MAX_ENTRIES);
  if (list.length === 1) {
    const job = list[0] as ImageJobView;
    await downloadImage(job.url as string, downloadName(job));
    return { saved: 1, failed: 0 };
  }
  const names = uniqueNames(list.map(downloadName));
  const blobs: Array<{ name: string; data: Blob; modified: Date } | null> = new Array(list.length).fill(null);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      const job = list[index] as ImageJobView;
      try {
        const data = await readImageBlob(job.url as string, { mode: "cors" });
        blobs[index] = { name: names[index] as string, data, modified: new Date(job.createdAt) };
      } catch (error) {
        console.warn("[works] picture not downloaded", { job: job.id, error: String(error) });
      }
      done += 1;
      onProgress?.(done, list.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, list.length) }, worker));
  const entries = blobs.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const failed = list.length - entries.length;
  if (entries.length) save(await createZip(entries), `作品-${stamp()}-${entries.length}张.zip`);
  console.info("[works] zip", { saved: entries.length, failed });
  return { saved: entries.length, failed };
}

/**
 * Deletes pictures and offers 撤销 on the toast. `onRemoved` takes them off
 * the page at once (the server agrees by then); `onRestored` puts them back
 * after an undo. Pictures still being made are skipped by the server and
 * stay on the page.
 */
export function useDeleteWorks({
  onRemoved,
  onRestored,
}: {
  onRemoved: (ids: string[]) => void;
  onRestored: (ids: string[]) => void;
}) {
  const { session } = useAuth();
  const { show, error } = useToast();
  const tokenRef = useRef(session?.access_token ?? null);
  tokenRef.current = session?.access_token ?? null;
  const callbacks = useRef({ onRemoved, onRestored });
  callbacks.current = { onRemoved, onRestored };

  return useCallback(
    async (ids: string[]): Promise<string[]> => {
      const token = tokenRef.current;
      if (!token || ids.length === 0) return [];
      try {
        const result = await deleteJobs(token, ids);
        console.info("[works] deleted", { asked: ids.length, deleted: result.deleted.length, skipped: result.skipped.length });
        if (result.deleted.length) callbacks.current.onRemoved(result.deleted);
        const skippedNote = result.skipped.length ? `，${result.skipped.length} 张还在生成，没有删除` : "";
        if (result.deleted.length)
          show({
            variant: "success",
            message: `已删除 ${result.deleted.length} 张${skippedNote}`,
            action: {
              label: "撤销",
              onClick: () => {
                const again = tokenRef.current;
                if (!again) return;
                void restoreJobs(again, result.deleted)
                  .then(({ restored }) => {
                    console.info("[works] restored", { count: restored.length });
                    if (restored.length) callbacks.current.onRestored(restored);
                    if (restored.length < result.deleted.length)
                      error(`有 ${result.deleted.length - restored.length} 张已经清理，找不回来了。`);
                  })
                  .catch((cause) => {
                    console.warn("[works] restore failed", cause);
                    error("撤销没有成功，请再试一次。");
                  });
              },
            },
          });
        else if (result.skipped.length) show({ variant: "info", message: "选中的图还在生成，完成后才能删除。" });
        return result.deleted;
      } catch (cause) {
        console.warn("[works] delete failed", cause);
        error("删除没有成功，请再试一次。");
        return [];
      }
    },
    [show, error],
  );
}
