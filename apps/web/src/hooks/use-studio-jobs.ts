"use client";

/**
 * Studio job state: the latest image jobs (one page), polled while any is
 * active, plus older pages the user asked for (「加载更早」). A poll only
 * refreshes the latest page; pictures that slid off it stay in the list, so
 * a long session never loses what it already showed.
 *
 * Billing rules this hook enforces:
 * - One click sends one batch request (any number of pictures since 第 57 条,
 *   each its own job and charge); the submit is locked while in flight.
 * - Nothing is re-submitted automatically (no retry on any error).
 * - Pictures still waiting at the server's dispatch gate (queued, unsent)
 *   can be canceled for free; sent ones run to the end.
 * - When a job this session submitted settles, the balance refreshes and a
 *   failure is reported once through the issue center.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useIssues } from "@/components/issues/issue-provider";
import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import {
  type ImageJobView,
  isActiveJob,
  isFailedJob,
  isSavingJob,
  toImageJobView,
} from "@/lib/image-jobs";
import {
  type CreateImageBatchInput,
  ApiApplicationError,
  cancelJob as apiCancelJob,
  cancelImageBatch,
  createImageBatch,
  fetchJobs,
} from "@/lib/server-api";

const POLL_MS = 4000;

/** One model × count, or several models side by side (`targets`, 第 56 条). */
export type StudioSubmitInput = CreateImageBatchInput;
/** Jobs per page, the latest page and each older one. */
export const STUDIO_PAGE = 50;

/**
 * The fresh latest page first; earlier rows that are older than it (they
 * slid off the page, or came from 「加载更早」) after it, in their order.
 * Rows inside the page's time span that it no longer lists are gone.
 */
export function mergeLatest(
  fresh: ImageJobView[],
  prev: ImageJobView[],
  pageFull: boolean,
): ImageJobView[] {
  const oldest = fresh.at(-1)?.createdAt;
  if (!pageFull || !oldest) return fresh;
  const ids = new Set(fresh.map((job) => job.id));
  return [...fresh, ...prev.filter((job) => !ids.has(job.id) && job.createdAt < oldest)];
}
/** Pictures queued by one click; `queued < requested` when the server stopped part way. */
export type StudioSubmitResult = { queued: number; requested: number };

export function useStudioJobs() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const { notifyGenerationSettled, refreshImageModels } = useAccount();
  const { report, reportCode } = useIssues();

  const [jobs, setJobs] = useState<ImageJobView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Where the next older page starts; null when everything is shown.
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderLoaded = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // Jobs created in this page session: they light up when they finish and
  // their failures are announced. Older rows stay quiet.
  const sessionJobs = useRef(new Set<string>());
  const settled = useRef(new Set<string>());
  const announcedSaving = useRef(new Set<string>());
  const [justDeveloped, setJustDeveloped] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const current = tokenRef.current;
    if (!current) return;
    try {
      const page = await fetchJobs(current, { jobType: "image_generation", limit: STUDIO_PAGE });
      const views = page.jobs.map(toImageJobView);
      // Older servers send no next_before: a full page then means "maybe more".
      const pageFull = page.next_before != null || views.length >= STUDIO_PAGE;
      setJobs((prev) => mergeLatest(views, prev, pageFull));
      // Once older pages are in, their own cursor goes on; until then the
      // latest page's is the start.
      if (!olderLoaded.current) setCursor(page.next_before ?? null);
      setLoadError(null);
      // Detect transitions for jobs this session submitted.
      const developed: string[] = [];
      for (const job of views) {
        if (!sessionJobs.current.has(job.id) || settled.current.has(job.id)) continue;
        if (isSavingJob(job) && !announcedSaving.current.has(job.id)) {
          announcedSaving.current.add(job.id);
          reportCode("storage_retrying", job.errorMessage);
        }
        if (isActiveJob(job)) continue;
        settled.current.add(job.id);
        notifyGenerationSettled();
        if (job.status === "succeeded") developed.push(job.id);
        else if (isFailedJob(job)) {
          reportCode(job.errorCode ?? "upstream_unknown", job.errorMessage);
          if (job.errorCode === "model_not_accessible") void refreshImageModels();
        }
      }
      if (developed.length)
        setJustDeveloped((prev) => new Set([...prev, ...developed]));
    } catch (error) {
      console.warn("[studio] job list failed", error);
      setLoadError(error instanceof ApiApplicationError ? error.code : "network");
    } finally {
      setLoading(false);
    }
  }, [notifyGenerationSettled, refreshImageModels, reportCode]);

  useEffect(() => {
    if (!token) return;
    void load();
    // Only on sign-in; token refreshes must not reload the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  const activeCount = useMemo(() => jobs.filter(isActiveJob).length, [jobs]);
  // Poll while something develops; pause when the tab is hidden.
  useEffect(() => {
    if (activeCount === 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      timer = setTimeout(async () => {
        if (document.visibilityState === "visible") await load();
        tick();
      }, POLL_MS);
    };
    tick();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [activeCount, load]);

  /** 「加载更早」: the next older page, appended. */
  const loadOlder = useCallback(async () => {
    const current = tokenRef.current;
    if (!current || !cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchJobs(current, {
        jobType: "image_generation",
        before: cursor,
        limit: STUDIO_PAGE,
      });
      const views = page.jobs.map(toImageJobView);
      olderLoaded.current = true;
      setJobs((prev) => {
        const ids = new Set(prev.map((job) => job.id));
        return [...prev, ...views.filter((job) => !ids.has(job.id))];
      });
      setCursor(page.next_before ?? null);
      console.info("[studio] older page", { from: cursor, rows: views.length, more: Boolean(page.next_before) });
    } catch (error) {
      console.warn("[studio] older page failed", error);
      report(error);
    } finally {
      setLoadingOlder(false);
    }
  }, [cursor, loadingOlder, report]);

  const submit = useCallback(
    async (input: StudioSubmitInput): Promise<StudioSubmitResult | null> => {
      const current = tokenRef.current;
      if (!current || submittingRef.current) return null;
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const batch = await createImageBatch(current, input);
        const views = batch.jobs.map(toImageJobView);
        for (const view of views) sessionJobs.current.add(view.id);
        const ids = new Set(views.map((view) => view.id));
        // Newest first, and the batch in its own order (index 0 first).
        setJobs((prev) => [...views, ...prev.filter((j) => !ids.has(j.id))]);
        console.info("[studio] batch queued", {
          batch: batch.batch_id,
          queued: views.length,
          requested: batch.requested,
          models: input.targets?.length ?? 1,
        });
        return { queued: views.length, requested: batch.requested };
      } catch (error) {
        const spec = report(error);
        if (error instanceof ApiApplicationError && error.code === "model_not_accessible")
          void refreshImageModels();
        if (spec) console.warn("[studio] submit rejected", spec.title);
        return null;
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [refreshImageModels, report],
  );

  const cancel = useCallback(
    async (jobId: string) => {
      const current = tokenRef.current;
      if (!current) return;
      try {
        const { job } = await apiCancelJob(current, jobId);
        const view = toImageJobView(job);
        settled.current.add(view.id);
        setJobs((prev) => prev.map((j) => (j.id === view.id ? view : j)));
      } catch (error) {
        // Most likely the worker already picked it up: it can no longer be
        // canceled because the request may be at the main site.
        report(
          error instanceof ApiApplicationError
            ? new ApiApplicationError(
                error.code,
                "这张已经开始生成，请求已发往主站，无法取消。",
                error.status,
              )
            : error,
        );
        void load();
      }
    },
    [load, report],
  );

  /**
   * Cancels the pictures of a batch the server has not sent yet. Returns how
   * many were canceled; ones already sent keep running and are charged.
   */
  const cancelBatch = useCallback(
    async (batchId: string): Promise<number> => {
      const current = tokenRef.current;
      if (!current) return 0;
      try {
        const { canceled } = await cancelImageBatch(current, batchId);
        const gone = new Set(canceled);
        for (const id of canceled) settled.current.add(id);
        setJobs((prev) =>
          prev.map((j) => (gone.has(j.id) ? { ...j, status: "canceled" as const } : j)),
        );
        console.info("[studio] batch canceled", { batch: batchId, canceled: canceled.length });
        void load();
        return canceled.length;
      } catch (error) {
        report(error);
        void load();
        return 0;
      }
    },
    [load, report],
  );

  return {
    jobs,
    loading,
    loadError,
    reload: load,
    /** Older pictures exist past what is shown. */
    hasOlder: cursor !== null,
    loadingOlder,
    loadOlder,
    submit,
    submitting,
    cancel,
    cancelBatch,
    activeCount,
    justDeveloped,
  };
}
