"use client";

/**
 * Studio job state: the latest 50 image jobs, polled while any is active.
 *
 * Billing rules this hook enforces:
 * - One click sends one batch request (1 to IMAGE_BATCH_MAX pictures, each
 *   its own job and charge); the submit is locked while in flight.
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
  type CreateImageJobInput,
  ApiApplicationError,
  cancelJob as apiCancelJob,
  cancelImageBatch,
  createImageBatch,
  fetchJobs,
} from "@/lib/server-api";

const POLL_MS = 4000;
/**
 * Mirrors the server's LOOMIC_MAX_PENDING_IMAGE_JOBS (queued + generating
 * per user) and LOOMIC_MAX_CONCURRENT_JOBS (sent at once). The server is the
 * authority; these only shape the button and its explanation.
 */
export const MAX_PENDING_JOBS = 8;
export const MAX_IN_FLIGHT = 2;

export type StudioSubmitInput = CreateImageJobInput & { count: number };
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
      const { jobs: rows } = await fetchJobs(current, { jobType: "image_generation" });
      const views = rows.map(toImageJobView);
      setJobs(views);
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
  // Jobs holding a generation slot. A saving job is already paid and only
  // waits for storage; the server does not count it toward the limit either.
  const busyCount = useMemo(
    () => jobs.filter((job) => isActiveJob(job) && !isSavingJob(job)).length,
    [jobs],
  );

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
    submit,
    submitting,
    cancel,
    cancelBatch,
    activeCount,
    busyCount,
    justDeveloped,
  };
}
