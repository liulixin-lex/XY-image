import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type {
  BackgroundJob,
  BackgroundJobStatus,
  BackgroundJobType,
  CreateImageJobRequest,
} from "@loomic/shared";
import {
  IMAGE_JOB_SOURCES,
  JOB_LIST_VIEWS,
  JOB_PAGE_MAX,
  applicationErrorResponseSchema,
  cancelImageBatchResponseSchema,
  createImageBatchRequestSchema,
  createImageJobRequestSchema,
  imageBatchResponseSchema,
  jobDeleteResponseSchema,
  jobIdsRequestSchema,
  jobListResponseSchema,
  jobResponseSchema,
  jobRestoreResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@loomic/shared";

import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import {
  ImageBatchSlotsError,
  canvasPlacement,
  createImageBatchJobs,
  titleOf,
} from "../features/jobs/image-batch.js";
import {
  type JobListFilters,
  type JobService,
  JobServiceError,
} from "../features/jobs/job-service.js";
import {
  type BillingGuard,
  imagePayloadSchema,
  storedOutputOptions,
} from "../features/xy2api/billing-guard.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import { isZodError } from "../utils/zod-error.js";
import { sendAccountError } from "./account.js";

export async function registerJobRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    billing: BillingGuard;
    jobService: JobService;
    viewerService: ViewerService;
  },
) {
  app.post("/api/jobs/image-generation", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);
      const payload = createImageJobRequestSchema.parse(request.body);
      const viewer = await options.viewerService.ensureViewer(user);
      const job = await options.billing.withUserLock(user.id, async () => {
        const prepared = await options.billing.prepareImageJob(user, payload);
        const input = imagePayloadSchema.parse({
          ...payload,
          model: prepared.model,
          resolution: prepared.resolution,
          quality: prepared.quality,
          aspect_ratio: prepared.aspect_ratio,
          ...storedOutputOptions(prepared),
        });
        return options.jobService.createJob(user, {
          workspaceId: viewer.workspace.id,
          jobType: "image_generation",
          xy2apiKeyId: prepared.keyId,
          ...(payload.project_id ? { projectId: payload.project_id } : {}),
          ...(payload.canvas_id ? { canvasId: payload.canvas_id } : {}),
          ...(payload.session_id ? { sessionId: payload.session_id } : {}),
          ...(payload.thread_id ? { threadId: payload.thread_id } : {}),
          payload: {
            ...input,
            ...titleOf(payload),
            ...canvasPlacement(payload, 0),
          },
        });
      });
      return reply
        .code(201)
        .send(jobResponseSchema.parse({ job: forClient(job) }));
    } catch (error) {
      if (error instanceof JobServiceError)
        return sendJobError(error, reply, "job_create_failed");
      return sendAccountError(reply, error);
    }
  });

  // POST /api/jobs/image-generation/batch — pictures from one description:
  // `count` of one model, or `targets` (多模型, 第 56 条): several models side
  // by side, possibly through different main-site keys. No product limit
  // since 第 57 条; IMAGE_REQUEST_MAX only guards against runaway requests.
  // Each picture is its own job and its own main-site request (and charge);
  // they share batch_id in the payload and are numbered across the targets.
  // LOOMIC_MAX_PENDING_IMAGE_JOBS / LOOMIC_MAX_CONCURRENT_JOBS, when set
  // (0 = no limit), still apply.
  app.post("/api/jobs/image-generation/batch", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);
      const body = createImageBatchRequestSchema.parse(request.body);
      const viewer = await options.viewerService.ensureViewer(user);
      const batch = await createImageBatchJobs(
        { billing: options.billing, jobService: options.jobService },
        user,
        viewer.workspace.id,
        body,
      );
      return reply.code(201).send(
        imageBatchResponseSchema.parse({
          batch_id: batch.batchId,
          requested: batch.requested,
          jobs: batch.jobs.map(forClient),
        }),
      );
    } catch (error) {
      if (error instanceof ImageBatchSlotsError)
        return reply.code(400).send(
          applicationErrorResponseSchema.parse({
            error: { code: "invalid_input", message: error.message },
          }),
        );
      if (error instanceof JobServiceError)
        return sendJobError(error, reply, "job_create_failed");
      return sendAccountError(reply, error);
    }
  });

  // POST /api/jobs/image-batches/:batchId/cancel — cancel the pictures of a
  // batch that have not been sent yet; the ones already sent finish.
  app.post(
    "/api/jobs/image-batches/:batchId/cancel",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user) return sendUnauthenticated(reply);
        const { batchId } = batchParamsSchema.parse(request.params);
        const canceled = await options.jobService.cancelUnsentInBatch(
          user,
          batchId,
        );
        return reply.code(200).send(
          cancelImageBatchResponseSchema.parse({
            batch_id: batchId,
            canceled,
          }),
        );
      } catch (error) {
        if (isZodError(error)) return sendAccountError(reply, error);
        return sendJobError(error, reply, "job_cancel_failed");
      }
    },
  );

  // GET /api/jobs/:jobId — get job status
  app.get("/api/jobs/:jobId", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const { jobId } = request.params as { jobId: string };
      const job = await options.jobService.getJob(user, jobId);

      return reply
        .code(200)
        .send(jobResponseSchema.parse({ job: forClient(job) }));
    } catch (error) {
      return sendJobError(error, reply, "job_query_failed");
    }
  });

  // GET /api/jobs — list jobs
  app.get("/api/jobs", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const query = jobListQuerySchema.parse(request.query ?? {});
      const filters: JobListFilters = {};
      if (query.status) filters.status = query.status as BackgroundJobStatus;
      if (query.job_type) filters.jobType = query.job_type as BackgroundJobType;
      if (query.before) filters.before = query.before;
      if (query.offset) filters.offset = query.offset;
      if (query.limit) filters.limit = query.limit;
      if (query.source) filters.source = query.source;
      if (query.view) filters.view = query.view;
      if (query.with_total) filters.withTotal = true;
      const jobs = await options.jobService.listJobs(user, filters);
      const last = jobs.at(-1);

      return reply.code(200).send(
        jobListResponseSchema.parse({
          jobs: jobs.map(forClient),
          // 历史 pages (第 56 条): older jobs exist before the last one here.
          next_before: jobs.more && last ? last.created_at : null,
          ...(jobs.total === undefined ? {} : { total: jobs.total }),
          ...(jobs.counts ? { counts: jobs.counts } : {}),
        }),
      );
    } catch (error) {
      return sendJobError(error, reply, "job_query_failed");
    }
  });

  // POST /api/jobs/delete — delete finished pictures (第 58 条). A POST with
  // a body rather than DELETE: some proxies drop DELETE bodies.
  app.post("/api/jobs/delete", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const { ids } = jobIdsRequestSchema.parse(request.body ?? {});
      const result = await options.jobService.deleteJobs(user, ids);
      return reply.code(200).send(jobDeleteResponseSchema.parse(result));
    } catch (error) {
      return sendJobError(error, reply, "job_delete_failed");
    }
  });

  // POST /api/jobs/restore — undo a delete before the purge ran.
  app.post("/api/jobs/restore", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const { ids } = jobIdsRequestSchema.parse(request.body ?? {});
      const restored = await options.jobService.restoreJobs(user, ids);
      return reply.code(200).send(jobRestoreResponseSchema.parse({ restored }));
    } catch (error) {
      return sendJobError(error, reply, "job_delete_failed");
    }
  });

  // POST /api/jobs/:jobId/cancel — cancel job
  app.post("/api/jobs/:jobId/cancel", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const { jobId } = request.params as { jobId: string };
      const job = await options.jobService.cancelJob(user, jobId);

      return reply
        .code(200)
        .send(jobResponseSchema.parse({ job: forClient(job) }));
    } catch (error) {
      return sendJobError(error, reply, "job_cancel_failed");
    }
  });
}

const batchParamsSchema = z.object({ batchId: z.string().uuid() });

/**
 * The label lists show (第 58 条): the user's own words when the prompt sent
 * carries more, e.g. a brand kit's rules. Absent: lists fall back to prompt.
 */
/**
 * GET /api/jobs: filters and the page. `before` = created_at of the last job
 * seen (作品 scroll); `offset` for numbered pages (生成记录), with
 * `with_total=1` for the total and the per-filter counts.
 */
const jobListQuerySchema = z.object({
  status: z.string().max(40).optional(),
  job_type: z.string().max(40).optional(),
  before: z.iso.datetime({ offset: true }).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(JOB_PAGE_MAX).optional(),
  source: z.enum(IMAGE_JOB_SOURCES).optional(),
  view: z.enum(JOB_LIST_VIEWS).optional(),
  with_total: z.enum(["1", "true"]).optional(),
});

/**
 * A job as the browser gets it. Inline reference images (data URIs) are cut
 * to their header: the page only counts them, and one 2K reference is about
 * 3 MB that every /api/jobs poll would download again. The worker reads the
 * full payload from the database, not from here.
 */
function forClient(job: BackgroundJob): BackgroundJob {
  const images = job.payload?.input_images;
  const inline = (value: unknown): value is string =>
    typeof value === "string" && value.startsWith("data:");
  if (!Array.isArray(images) || !images.some(inline)) return job;
  return {
    ...job,
    payload: {
      ...job.payload,
      input_images: images.map((value) =>
        inline(value)
          ? value.slice(0, value.indexOf(",") + 1) || "data:"
          : value,
      ),
    },
  };
}

function sendUnauthenticated(reply: FastifyReply) {
  return reply.code(401).send(
    unauthenticatedErrorResponseSchema.parse({
      error: {
        code: "unauthorized",
        message: "Missing or invalid bearer token.",
      },
    }),
  );
}

type JobErrorFallbackCode =
  | "job_not_found"
  | "job_create_failed"
  | "job_query_failed"
  | "job_cancel_failed"
  | "job_delete_failed";

function sendJobError(
  error: unknown,
  reply: FastifyReply,
  fallbackCode: JobErrorFallbackCode,
) {
  if (error instanceof JobServiceError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchema.parse({
        error: { code: error.code, message: error.message },
      }),
    );
  }
  if (isZodError(error))
    return reply.code(400).send(
      applicationErrorResponseSchema.parse({
        error: { code: "invalid_input", message: "请求参数无效" },
      }),
    );
  return reply.code(500).send(
    applicationErrorResponseSchema.parse({
      error: {
        code: fallbackCode,
        message: "An unexpected error occurred.",
      },
    }),
  );
}
