import {
  IMAGE_QUALITIES,
  IMAGE_RESOLUTIONS,
  LEGACY_IMAGE_QUALITIES,
} from "@loomic/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerEnv } from "../config/env.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { JobService } from "../features/jobs/job-service.js";
import {
  BillingGuardError,
  DeliveryPendingError,
} from "../features/xy2api/errors.js";
import { executeImageJob } from "../features/xy2api/image-runner.js";
import type { PendingDeliveryStore } from "../features/xy2api/pending-delivery.js";
import type { Xy2apiServices } from "../features/xy2api/services.js";
import type { AdminSupabaseClient } from "../supabase/admin.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import { sendAccountError } from "./account.js";

const schema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  model: z.string().optional(),
  aspectRatio: z.string().max(10).optional(),
  resolution: z.enum(IMAGE_RESOLUTIONS).optional(),
  /** auto / low / medium / high; standard / hd from older pages still work. */
  quality: z.enum([...IMAGE_QUALITIES, ...LEGACY_IMAGE_QUALITIES]).optional(),
  inputImages: z.array(z.string()).max(14).optional(),
});
export function registerGenerateRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    viewerService: ViewerService;
    jobService?: JobService;
    xy2api: Xy2apiServices;
    env: ServerEnv;
    getAdminClient: () => AdminSupabaseClient;
    /** Charged images held after a storage failure; the worker retries them (M6). */
    deliveries?: PendingDeliveryStore;
  },
) {
  app.post("/api/agent/generate-image", async (request, reply) => {
    let jobId: string | undefined;
    try {
      const user = await options.auth.authenticate(request);
      if (!user) throw new BillingGuardError("xy2api_reauth_required", 401);
      const payload = schema.parse(request.body);
      const jobService = options.jobService;
      if (!jobService) throw new Error("Job service unavailable");
      const viewer = await options.viewerService.ensureViewer(user);
      const job = await options.xy2api.billing.withUserLock(
        user.id,
        async () => {
          // Sent from this process, not the worker: no dispatch gate here.
          const prepared = await options.xy2api.billing.prepareImageJob(
            user,
            {
              model: payload.model,
              resolution: payload.resolution,
              quality: payload.quality,
              aspect_ratio: payload.aspectRatio,
              input_images: payload.inputImages,
            },
            { sendsNow: true },
          );
          return jobService.createJob(user, {
            workspaceId: viewer.workspace.id,
            jobType: "image_generation",
            enqueue: false,
            xy2apiKeyId: prepared.keyId,
            payload: {
              prompt: payload.prompt,
              model: prepared.model,
              resolution: prepared.resolution,
              quality: prepared.quality,
              aspect_ratio: prepared.aspect_ratio,
              ...(payload.inputImages
                ? { input_images: payload.inputImages }
                : {}),
            },
          });
        },
      );
      jobId = job.id;
      await jobService.markRunning(job.id);
      const result = await executeImageJob(job.id, options);
      await jobService.markSucceeded(job.id, result);
      return {
        url: result.signed_url,
        assetId: result.asset_id,
        prompt: payload.prompt,
        mimeType: result.mime_type,
        width: result.width,
        height: result.height,
      };
    } catch (caught) {
      let error = caught;
      if (jobId && error instanceof DeliveryPendingError && options.jobService)
        try {
          // The image is charged and held; hand the storage retries to the worker.
          await options.jobService.markRetrying(
            jobId,
            error.code,
            error.message,
          );
          await options.jobService.scheduleRedelivery(
            jobId,
            error.retryInSeconds,
          );
          return sendAccountError(reply, error);
        } catch {
          console.error(
            `[generate-image] job ${jobId} storage retry not scheduled; image stays held for manual recovery`,
          );
          error = new BillingGuardError("storage_failed", 502);
        }
      if (jobId)
        await options.jobService
          ?.markDeadLetter(
            jobId,
            error instanceof BillingGuardError
              ? error.code
              : "upstream_unknown",
            error instanceof BillingGuardError
              ? error.message
              : "请求状态未知，请到主站核对用量",
          )
          .catch(() => {});
      return sendAccountError(reply, error);
    }
  });
}
