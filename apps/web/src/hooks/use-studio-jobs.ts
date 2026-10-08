"use client";

/**
 * Studio job state: the latest 50 image jobs, polled while any is active.
 *
 * Billing rules this hook enforces:
 * - One click creates at most one job; the submit is locked while in flight.
 * - A job is never re-submitted automatically (no retry on any error).
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
  toImageJobView,
} from "@/lib/image-jobs";
import {
  type CreateImageJobInput,
  ApiApplicationError,
  cancelJob as apiCancelJob,
  createImageJob,
  fetchJobs,
} from "@/lib/server-api";

const POLL_MS = 4000;
export const MAX_ACTIVE_JOBS = 2;

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

  const submit = useCallback(
    async (input: CreateImageJobInput): Promise<boolean> => {
      const current = tokenRef.current;
      if (!current || submittingRef.current) return false;
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const { job } = await createImageJob(current, input);
        const view = toImageJobView(job);
        sessionJobs.current.add(view.id);
        setJobs((prev) => [view, ...prev.filter((j) => j.id !== view.id)]);
        console.info("[studio] job queued", view.id);
        return true;
      } catch (error) {
        const spec = report(error);
        if (error instanceof ApiApplicationError && error.code === "model_not_accessible")
          void refreshImageModels();
        if (spec) console.warn("[studio] submit rejected", spec.title);
        return false;
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

  return {
    jobs,
    loading,
    loadError,
    reload: load,
    submit,
    submitting,
    cancel,
    activeCount,
    justDeveloped,
  };
}
