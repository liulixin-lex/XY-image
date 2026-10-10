import { canvasPlacementPayloadSchema } from "@loomic/shared";

import { describeErrorForLog } from "../../../utils/error-sanitizer.js";
import { insertImageElement } from "../../canvas/canvas-element-writer.js";
import {
  type ImageJobResult,
  executeImageJob,
} from "../../xy2api/image-runner.js";
import { createXy2apiServices } from "../../xy2api/services.js";
import { type ExecutorContext, registerExecutor } from "../job-executor.js";

registerExecutor("image_generation", async (jobId, _rawPayload, ctx) => {
  const xy2api = createXy2apiServices(ctx.env, ctx.getAdminClient);
  let result: ImageJobResult;
  try {
    result = await executeImageJob(jobId, { ...ctx, xy2api });
  } finally {
    await xy2api.providers.network.close();
  }
  return { ...result, ...(await placeOnCanvas(jobId, result, ctx)) };
});

/**
 * Agent image jobs carry the canvas they were asked from, and the worker puts
 * the image there. A result that arrives after the agent stopped waiting
 * (held for storage retries, or past its poll limit) still reaches the
 * canvas; the page picks it up when it polls the job. Placement is once per
 * job (`jobId` on the element), so a redelivered message adds nothing.
 *
 * A node-canvas job carries its slot and generator node (`canvas_slot`,
 * `canvas_source_id`): the picture goes in that slot with an edge from the
 * generator. A malformed placement is ignored, never fatal.
 *
 * A failure only logs: the image is in the user's history either way, and the
 * agent runtime places it itself when the result has no `element_id`.
 */
async function placeOnCanvas(
  jobId: string,
  result: ImageJobResult,
  ctx: ExecutorContext,
): Promise<{ element_id?: string }> {
  let canvasId: string | null = null;
  try {
    const job = await ctx.jobService.getJobAdmin(jobId);
    canvasId = job.canvas_id;
    if (!canvasId) return {};
    const placement = canvasPlacementPayloadSchema.safeParse(job.payload ?? {});
    if (!placement.success)
      console.warn(
        `[image-generation] job ${jobId}: canvas placement ignored (invalid)`,
      );
    const { canvas_slot: slot, canvas_source_id: sourceElementId } =
      placement.success ? placement.data : {};
    const { elementId, inserted } = await insertImageElement(
      ctx.getAdminClient(),
      {
        canvasId,
        objectPath: result.object_path,
        width: result.width,
        height: result.height,
        mimeType: result.mime_type,
        jobId,
        ...titleOf(job.payload),
        ...(sourceElementId ? { sourceElementId } : {}),
      },
      slot,
    );
    console.log(
      `[image-generation] job ${jobId} ${inserted ? "placed on" : "already on"} canvas ${canvasId}`,
    );
    return { element_id: elementId };
  } catch (error) {
    console.error(
      `[image-generation] job ${jobId} not placed on canvas ${canvasId ?? "?"}: ${describeErrorForLog(error)}`,
    );
    return {};
  }
}

// The agent's title for the image (runtime stores it in the payload), or the
// start of the prompt for jobs created before it did.
function titleOf(payload: unknown): { title?: string } {
  const { title, prompt } = (payload ?? {}) as {
    title?: unknown;
    prompt?: unknown;
  };
  const text =
    typeof title === "string" && title.trim()
      ? title.trim().slice(0, 200)
      : typeof prompt === "string"
        ? prompt.trim().slice(0, 40)
        : "";
  return text ? { title: text } : {};
}
