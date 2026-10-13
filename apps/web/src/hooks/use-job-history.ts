"use client";

/**
 * 最近生成 (第 56 条): every finished picture, newest first, one page at a
 * time (GET /api/jobs with next_before). Changing the source filter starts
 * over; a page that arrives after the filter changed is dropped.
 *
 * Nothing here sends a generation. Deleting (第 58 条) goes through
 * works-actions; `remove` and `restore` only update this list to match.
 */
import type { ImageJobSource } from "@loomic/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { type ImageJobView, toImageJobView } from "@/lib/image-jobs";
import { ApiApplicationError, fetchJobs } from "@/lib/server-api";

export const HISTORY_PAGE = 60;

export function useJobHistory(source: ImageJobSource | null) {
  const { session } = useAuth();
  const tokenRef = useRef(session?.access_token ?? null);
  tokenRef.current = session?.access_token ?? null;

  const [items, setItems] = useState<ImageJobView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every reset: an older request's page is ignored.
  const generation = useRef(0);
  const inFlight = useRef(false);
  // Deleted pictures, kept so 撤销 can put them back where they were.
  const removed = useRef(new Map<string, ImageJobView>());

  const loadPage = useCallback(
    async (from: string | null, gen: number) => {
      const token = tokenRef.current;
      if (!token || inFlight.current) return;
      inFlight.current = true;
      setLoading(true);
      try {
        const page = await fetchJobs(token, {
          jobType: "image_generation",
          status: "succeeded",
          limit: HISTORY_PAGE,
          ...(from ? { before: from } : {}),
          ...(source ? { source } : {}),
        });
        if (gen !== generation.current) return;
        const views = page.jobs.map(toImageJobView).filter((job) => job.url);
        setItems((prev) => {
          const ids = new Set(prev.map((job) => job.id));
          return [...prev, ...views.filter((job) => !ids.has(job.id))];
        });
        // Older servers send no cursor: they only ever have the one page.
        const next = page.next_before ?? null;
        setCursor(next);
        setDone(next === null);
        setError(null);
        console.info("[history] page", { source, from, rows: page.jobs.length, more: next !== null });
      } catch (err) {
        if (gen !== generation.current) return;
        console.warn("[history] page failed", err);
        setError(err instanceof ApiApplicationError ? err.code : "network");
      } finally {
        inFlight.current = false;
        if (gen === generation.current) setLoading(false);
      }
    },
    [source],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: restart per user and filter, not per token refresh
  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setItems([]);
    setCursor(null);
    setDone(false);
    setError(null);
    if (session?.user.id) void loadPage(null, generation.current);
  }, [session?.user.id, source]);

  const loadMore = useCallback(() => {
    if (done || loading || !cursor) return;
    void loadPage(cursor, generation.current);
  }, [cursor, done, loading, loadPage]);

  const retry = useCallback(() => {
    void loadPage(cursor, generation.current);
  }, [cursor, loadPage]);

  const remove = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    setItems((prev) => {
      for (const job of prev) if (gone.has(job.id)) removed.current.set(job.id, job);
      return prev.filter((job) => !gone.has(job.id));
    });
  }, []);

  const restore = useCallback((ids: string[]) => {
    const back = ids
      .map((id) => removed.current.get(id))
      .filter((job): job is ImageJobView => Boolean(job));
    for (const id of ids) removed.current.delete(id);
    if (!back.length) return;
    setItems((prev) => {
      const have = new Set(prev.map((job) => job.id));
      return [...prev, ...back.filter((job) => !have.has(job.id))].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    });
  }, []);

  return {
    items,
    loading,
    error,
    done,
    loadMore,
    retry,
    remove,
    restore,
    started: items.length > 0 || done || Boolean(error),
  };
}
