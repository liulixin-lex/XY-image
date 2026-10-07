import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerEnv } from "../config/env.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { JobService } from "../features/jobs/job-service.js";
import { BillingGuardError } from "../features/xy2api/errors.js";
import { executeImageJob } from "../features/xy2api/image-runner.js";
import type { Xy2apiServices } from "../features/xy2api/services.js";
import type { AdminSupabaseClient } from "../supabase/admin.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import { sendAccountError } from "./account.js";

const schema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  model: z.string().optional(),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  quality: z.enum(["standard", "hd"]).optional(),
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
          const prepared = await options.xy2api.billing.prepareImageJob(
            user,
            payload,
          );
          return jobService.createJob(user, {
            workspaceId: viewer.workspace.id,
            jobType: "image_generation",
            enqueue: false,
            xy2apiKeyId: prepared.keyId,
            payload: {
              prompt: payload.prompt,
              model: prepared.model,
              quality: prepared.quality,
              ...(payload.aspectRatio
                ? { aspect_ratio: payload.aspectRatio }
                : {}),
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
    } catch (error) {
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
