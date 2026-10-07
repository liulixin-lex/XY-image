import { executeImageJob } from "../../xy2api/image-runner.js";
import { createXy2apiServices } from "../../xy2api/services.js";
import { registerExecutor } from "../job-executor.js";

registerExecutor("image_generation", async (jobId, _rawPayload, ctx) => {
  const xy2api = createXy2apiServices(ctx.env, ctx.getAdminClient);
  return executeImageJob(jobId, { ...ctx, xy2api });
});
