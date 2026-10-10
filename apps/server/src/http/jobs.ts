import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type {
  BackgroundJob,
  BackgroundJobStatus,
  BackgroundJobType,
  CanvasPlacementPayload,
  CreateImageJobRequest,
} from "@loomic/shared";
import {
  applicationErrorResponseSchema,
  cancelImageBatchResponseSchema,
  createImageBatchRequestSchema,
  createImageJobRequestSchema,
  imageBatchPayloadSchema,
  imageBatchResponseSchema,
  jobListResponseSchema,
  jobResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@loomic/shared";

import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import {
  type JobService,
  JobServiceError,
} from "../features/jobs/job-service.js";
import {
  type BillingGuard,
  imagePayloadSchema,
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
        });
        return options.jobService.createJob(user, {
          workspaceId: viewer.workspace.id,
          jobType: "image_generation",
          xy2apiKeyId: prepared.keyId,
          ...(payload.project_id ? { projectId: payload.project_id } : {}),
          ...(payload.canvas_id ? { canvasId: payload.canvas_id } : {}),
          ...(payload.session_id ? { sessionId: payload.session_id } : {}),
          ...(payload.thread_id ? { threadId: payload.thread_id } : {}),
          payload: { ...input, ...canvasPlacement(payload, 0) },
        });
      });
      return reply.code(201).send(jobResponseSchema.parse({ job }));
    } catch (error) {
      if (error instanceof JobServiceError)
        return sendJobError(error, reply, "job_create_failed");
      return sendAccountError(reply, error);
    }
  });

  // POST /api/jobs/image-generation/batch — 1 to IMAGE_BATCH_MAX pictures from
  // one description. Each picture is its own job and its own main-site
  // request (and charge); they share batch_id in the payload. All of them are
  // admitted against LOOMIC_MAX_PENDING_IMAGE_JOBS at once; the worker's
  // dispatch gate then sends at most LOOMIC_MAX_CONCURRENT_JOBS at a time.
  app.post("/api/jobs/image-generation/batch", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);
      const { count, ...payload } = createImageBatchRequestSchema.parse(
        request.body,
      );
      const viewer = await options.viewerService.ensureViewer(user);
      const batchId = randomUUID();
      const jobs = await options.billing.withUserLock(user.id, async () => {
        const prepared = await options.billing.prepareImageJob(user, payload, {
          count,
        });
        const input = imagePayloadSchema.parse({
          ...payload,
          model: prepared.model,
          resolution: prepared.resolution,
          quality: prepared.quality,
          aspect_ratio: prepared.aspect_ratio,
        });
        const created: BackgroundJob[] = [];
        for (let index = 0; index < count; index += 1) {
          try {
            created.push(
              await options.jobService.createJob(user, {
                workspaceId: viewer.workspace.id,
                jobType: "image_generation",
                xy2apiKeyId: prepared.keyId,
                ...(payload.project_id
                  ? { projectId: payload.project_id }
                  : {}),
                ...(payload.canvas_id ? { canvasId: payload.canvas_id } : {}),
                ...(payload.session_id
                  ? { sessionId: payload.session_id }
                  : {}),
                ...(payload.thread_id ? { threadId: payload.thread_id } : {}),
                payload: {
                  ...input,
                  ...canvasPlacement(payload, index),
                  ...imageBatchPayloadSchema.parse({
                    batch_id: batchId,
                    batch_index: index,
                    batch_size: count,
                  }),
                },
              }),
            );
          } catch (error) {
            // Nothing is sent at creation, so stopping part way costs
            // nothing: return what exists and let the page say how many.
            if (created.length === 0) throw error;
            console.error(
              `[jobs] batch ${batchId}: created ${created.length} of ${count}, the rest failed to queue`,
            );
            break;
          }
        }
        return created;
      });
      console.log(
        `[jobs] batch ${batchId} of user ${user.id}: ${jobs.length}/${count} queued`,
      );
      return reply.code(201).send(
        imageBatchResponseSchema.parse({
          batch_id: batchId,
          requested: count,
          jobs,
        }),
      );
    } catch (error) {
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

      return reply.code(200).send(jobResponseSchema.parse({ job }));
    } catch (error) {
      return sendJobError(error, reply, "job_query_failed");
    }
  });

  // GET /api/jobs — list jobs
  app.get("/api/jobs", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const query = request.query as { status?: string; job_type?: string };
      const filters: {
        status?: BackgroundJobStatus;
        jobType?: BackgroundJobType;
      } = {};
      if (query.status) filters.status = query.status as BackgroundJobStatus;
      if (query.job_type) filters.jobType = query.job_type as BackgroundJobType;
      const jobs = await options.jobService.listJobs(user, filters);

      return reply.code(200).send(jobListResponseSchema.parse({ jobs }));
    } catch (error) {
      return sendJobError(error, reply, "job_query_failed");
    }
  });

  // POST /api/jobs/:jobId/cancel — cancel job
  app.post("/api/jobs/:jobId/cancel", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const { jobId } = request.params as { jobId: string };
      const job = await options.jobService.cancelJob(user, jobId);

      return reply.code(200).send(jobResponseSchema.parse({ job }));
    } catch (error) {
      return sendJobError(error, reply, "job_cancel_failed");
    }
  });
}

const batchParamsSchema = z.object({ batchId: z.string().uuid() });

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
  | "job_cancel_failed";

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
  return reply.code(500).send(
    applicationErrorResponseSchema.parse({
      error: {
        code: fallbackCode,
        message: "An unexpected error occurred.",
      },
    }),
  );
}

/**
 * Node canvas: where picture `index` goes and the generator node it comes
 * from, stored in its job payload for the worker's canvas writer. Only kept
 * with a canvas; a missing slot lets the writer place the picture itself.
 */
function canvasPlacement(
  payload: CreateImageJobRequest,
  index: number,
): CanvasPlacementPayload {
  if (!payload.canvas_id) return {};
  const slot = payload.canvas_slots?.[index];
  return {
    ...(slot ? { canvas_slot: slot } : {}),
    ...(payload.canvas_source_id
      ? { canvas_source_id: payload.canvas_source_id }
      : {}),
  };
}
