import type {
  BackgroundJob,
  BackgroundJobStatus,
  BackgroundJobType,
  Json,
} from "@loomic/shared";
import { checkStoreError, integrationClient } from "../xy2api/store.js";

import type { PgmqClient } from "../../queue/pgmq-client.js";
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import type {
  AuthenticatedUser,
  UserSupabaseClient,
} from "../../supabase/user.js";

// Queue name mapping
const QUEUE_MAP: Record<BackgroundJobType, string> = {
  image_generation: "image_generation_jobs",
  video_generation: "video_generation_jobs",
};

export class JobServiceError extends Error {
  readonly statusCode: number;
  readonly code:
    | "job_not_found"
    | "job_create_failed"
    | "job_query_failed"
    | "job_cancel_failed";

  constructor(
    code: JobServiceError["code"],
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.name = "JobServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type CreateJobInput = {
  workspaceId: string;
  projectId?: string;
  canvasId?: string;
  sessionId?: string;
  threadId?: string;
  jobType: BackgroundJobType;
  payload: Record<string, unknown>;
  xy2apiKeyId?: number;
  enqueue?: boolean;
};

export type JobService = {
  createJob(
    user: AuthenticatedUser,
    input: CreateJobInput,
  ): Promise<BackgroundJob>;
  getJob(user: AuthenticatedUser, jobId: string): Promise<BackgroundJob>;
  listJobs(
    user: AuthenticatedUser,
    filters?: { status?: BackgroundJobStatus; jobType?: BackgroundJobType },
  ): Promise<BackgroundJob[]>;
  cancelJob(user: AuthenticatedUser, jobId: string): Promise<BackgroundJob>;
  getJobAdmin(jobId: string): Promise<BackgroundJob>;

  // Admin-only methods (use admin client, no user auth)
  markRunning(jobId: string): Promise<void>;
  markSucceeded(jobId: string, result: Record<string, unknown>): Promise<void>;
  markFailed(
    jobId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void>;
  markDeadLetter(
    jobId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void>;
  incrementAttempt(
    jobId: string,
  ): Promise<{ attempt_count: number; max_attempts: number }>;
  /**
   * A charged image is held for another storage attempt (M6): back to queued,
   * keeping the code/message so the UI shows "保存中" rather than a failure.
   */
  markRetrying(
    jobId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void>;
  /** Puts an existing job on its queue after `delaySeconds` (sync route storage retry). */
  scheduleRedelivery(jobId: string, delaySeconds: number): Promise<void>;
};

export function createJobService(options: {
  createUserClient: (accessToken: string) => UserSupabaseClient;
  getAdminClient: () => AdminSupabaseClient;
  pgmq: PgmqClient;
}): JobService {
  function mapJobRow(row: Record<string, unknown>): BackgroundJob {
    return {
      id: row.id as string,
      workspace_id: row.workspace_id as string,
      project_id: (row.project_id as string) ?? null,
      canvas_id: (row.canvas_id as string) ?? null,
      session_id: (row.session_id as string) ?? null,
      thread_id: (row.thread_id as string) ?? null,
      queue_name: row.queue_name as string,
      job_type: row.job_type as BackgroundJob["job_type"],
      status: row.status as BackgroundJob["status"],
      billing_status: (row.billing_status ?? "none") as NonNullable<
        BackgroundJob["billing_status"]
      >,
      xy2api_request_id: (row.xy2api_request_id as string) ?? null,
      payload: (row.payload as Record<string, unknown>) ?? {},
      result: (row.result as Record<string, unknown>) ?? null,
      error_code: (row.error_code as string) ?? null,
      error_message: (row.error_message as string) ?? null,
      attempt_count: row.attempt_count as number,
      max_attempts: row.max_attempts as number,
      created_by: row.created_by as string,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      started_at: (row.started_at as string) ?? null,
      completed_at: (row.completed_at as string) ?? null,
      failed_at: (row.failed_at as string) ?? null,
      canceled_at: (row.canceled_at as string) ?? null,
    };
  }

  const SELECT_COLS =
    "id, workspace_id, project_id, canvas_id, session_id, thread_id, queue_name, job_type, status, billing_status, xy2api_request_id, payload, result, error_code, error_message, attempt_count, max_attempts, created_by, created_at, updated_at, started_at, completed_at, failed_at, canceled_at";

  return {
    async createJob(user, input) {
      const client = integrationClient(options.getAdminClient());
      const { data: member, error: memberError } = await client
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", input.workspaceId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (
        memberError ||
        !member ||
        !input.xy2apiKeyId ||
        input.jobType !== "image_generation"
      )
        throw new JobServiceError("job_create_failed", "无法创建生图任务", 403);
      // The foreign keys accept anyone's project / canvas / session, and a
      // stranger's id on a job would also confirm that it exists.
      if (!(await referencesInWorkspace(client, input))) {
        console.warn(
          `[job-service] user ${user.id} referenced a project/canvas/session outside workspace ${input.workspaceId}`,
        );
        throw new JobServiceError(
          "job_create_failed",
          "找不到这个项目或画布，请刷新后重试",
          404,
        );
      }
      const queueName = QUEUE_MAP[input.jobType];

      const { data: job, error } = await client
        .from("background_jobs")
        .insert({
          workspace_id: input.workspaceId,
          project_id: input.projectId ?? null,
          canvas_id: input.canvasId ?? null,
          session_id: input.sessionId ?? null,
          thread_id: input.threadId ?? null,
          queue_name: queueName,
          job_type: input.jobType,
          payload: input.payload as Json,
          created_by: user.id,
          xy2api_key_id: input.xy2apiKeyId,
          max_attempts: 1,
        })
        .select(SELECT_COLS)
        .single();

      if (error || !job) {
        throw new JobServiceError(
          "job_create_failed",
          "Failed to create job record.",
          500,
        );
      }

      // Enqueue to pgmq — rollback on failure
      try {
        if (input.enqueue !== false)
          await options.pgmq.send(queueName, {
            job_id: job.id,
            job_type: input.jobType,
            workspace_id: input.workspaceId,
            ...(input.canvasId ? { canvas_id: input.canvasId } : {}),
            ...(input.sessionId ? { session_id: input.sessionId } : {}),
          });
      } catch (enqueueErr) {
        console.error("[job-service] enqueue failed");
        await client.from("background_jobs").delete().eq("id", job.id);
        throw new JobServiceError(
          "job_create_failed",
          "Failed to enqueue job.",
          500,
        );
      }

      return mapJobRow(job as unknown as Record<string, unknown>);
    },

    async getJob(user, jobId) {
      const client = options.createUserClient(user.accessToken);
      const { data: job, error } = await client
        .from("background_jobs")
        .select(SELECT_COLS)
        .eq("id", jobId)
        .maybeSingle();

      if (error) {
        throw new JobServiceError(
          "job_query_failed",
          "Failed to query job.",
          500,
        );
      }
      if (!job) {
        throw new JobServiceError("job_not_found", "Job not found.", 404);
      }
      return mapJobRow(job as unknown as Record<string, unknown>);
    },

    async listJobs(user, filters) {
      const client = options.createUserClient(user.accessToken);
      let query = client
        .from("background_jobs")
        .select(SELECT_COLS)
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.jobType) query = query.eq("job_type", filters.jobType);

      const { data: jobs, error } = await query;
      if (error) {
        throw new JobServiceError(
          "job_query_failed",
          "Failed to list jobs.",
          500,
        );
      }
      return (jobs ?? []).map((row) =>
        mapJobRow(row as unknown as Record<string, unknown>),
      );
    },

    async cancelJob(user, jobId) {
      const client = options.getAdminClient();
      const { data: job, error } = await client
        .from("background_jobs")
        .update({ status: "canceled", canceled_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("created_by", user.id)
        .in("status", ["queued", "running"])
        // A charged image waiting for storage is already paid for; keep it.
        .neq("billing_status", "charged")
        .select(SELECT_COLS)
        .maybeSingle();

      if (error) {
        throw new JobServiceError(
          "job_cancel_failed",
          "Failed to cancel job.",
          500,
        );
      }
      if (!job) {
        throw new JobServiceError(
          "job_not_found",
          "Job not found or already completed.",
          404,
        );
      }
      return mapJobRow(job as unknown as Record<string, unknown>);
    },

    async getJobAdmin(jobId) {
      const admin = options.getAdminClient();
      const { data: job, error } = await admin
        .from("background_jobs")
        .select(SELECT_COLS)
        .eq("id", jobId)
        .maybeSingle();

      if (error) {
        throw new JobServiceError(
          "job_query_failed",
          "Failed to query job.",
          500,
        );
      }
      if (!job) {
        throw new JobServiceError("job_not_found", "Job not found.", 404);
      }
      return mapJobRow(job as unknown as Record<string, unknown>);
    },

    // --- Admin-only methods (admin client, bypasses RLS) ---

    async markRunning(jobId) {
      const admin = options.getAdminClient();
      const { error } = await admin
        .from("background_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("status", "queued");
      checkStoreError(error);
    },

    async markSucceeded(jobId, result) {
      const admin = options.getAdminClient();
      const { error } = await admin
        .from("background_jobs")
        .update({
          status: "succeeded",
          result: result as Json,
          // Clears storage_retrying left by a held image's earlier attempts.
          error_code: null,
          error_message: null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      checkStoreError(error);
    },

    async markFailed(jobId, errorCode, errorMessage) {
      const admin = options.getAdminClient();
      const { error } = await admin
        .from("background_jobs")
        .update({
          status: "failed",
          error_code: errorCode,
          error_message: errorMessage,
          failed_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      checkStoreError(error);
    },

    async markDeadLetter(jobId, errorCode, errorMessage) {
      const admin = options.getAdminClient();
      const { error } = await admin
        .from("background_jobs")
        .update({
          status: "dead_letter",
          error_code: errorCode,
          error_message: errorMessage,
          failed_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      checkStoreError(error);
    },

    async markRetrying(jobId, errorCode, errorMessage) {
      const admin = options.getAdminClient();
      const { error } = await admin
        .from("background_jobs")
        .update({
          status: "queued",
          error_code: errorCode,
          error_message: errorMessage,
        })
        .eq("id", jobId)
        .in("status", ["queued", "running"]);
      checkStoreError(error);
    },

    async scheduleRedelivery(jobId, delaySeconds) {
      const { data: job, error } = await options
        .getAdminClient()
        .from("background_jobs")
        .select("id, queue_name, job_type, workspace_id, canvas_id, session_id")
        .eq("id", jobId)
        .single();
      checkStoreError(error);
      if (!job)
        throw new JobServiceError("job_not_found", "Job not found.", 404);
      await options.pgmq.send(
        job.queue_name,
        {
          job_id: job.id,
          job_type: job.job_type,
          workspace_id: job.workspace_id,
          ...(job.canvas_id ? { canvas_id: job.canvas_id } : {}),
          ...(job.session_id ? { session_id: job.session_id } : {}),
        },
        delaySeconds,
      );
    },

    async incrementAttempt(jobId) {
      const admin = options.getAdminClient();
      // NOTE: increment_job_attempt may not be in generated Supabase types yet
      const { data, error } = await integrationClient(admin).rpc(
        "increment_job_attempt",
        {
          p_job_id: jobId,
        },
      );

      if (error) {
        throw new JobServiceError(
          "job_query_failed",
          "Unable to record job attempt.",
          503,
        );
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (row && typeof row === "object") {
        return {
          attempt_count: row.attempt_count as number,
          max_attempts: (row.max_attempts as number) ?? 1,
        };
      }
      throw new JobServiceError("job_not_found", "Job not found.", 404);
    },
  };
}

/**
 * True when every project, canvas and session the job points at lives in the
 * job's workspace (canvas → project, session → canvas → project).
 */
async function referencesInWorkspace(
  client: ReturnType<typeof integrationClient>,
  input: Pick<
    CreateJobInput,
    "workspaceId" | "projectId" | "canvasId" | "sessionId"
  >,
): Promise<boolean> {
  const projects = new Set<string>();
  const canvases = new Set<string>();
  if (input.projectId) projects.add(input.projectId);
  if (input.canvasId) canvases.add(input.canvasId);
  if (input.sessionId) {
    const { data, error } = await client
      .from("chat_sessions")
      .select("canvas_id")
      .eq("id", input.sessionId)
      .maybeSingle();
    if (error) throw lookupFailed();
    if (!data) return false;
    canvases.add(data.canvas_id);
  }
  for (const id of canvases) {
    const { data, error } = await client
      .from("canvases")
      .select("project_id")
      .eq("id", id)
      .maybeSingle();
    if (error) throw lookupFailed();
    if (!data) return false;
    projects.add(data.project_id);
  }
  for (const id of projects) {
    const { data, error } = await client
      .from("projects")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (error) throw lookupFailed();
    if (!data) return false;
  }
  return true;
}
const lookupFailed = () =>
  new JobServiceError("job_create_failed", "Failed to create job record.", 500);
