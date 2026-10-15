import { randomUUID } from "node:crypto";

import {
  type BackgroundJob,
  type CanvasPlacementPayload,
  type CreateImageBatchRequest,
  type CreateImageJobRequest,
  imageBatchPayloadSchema,
  imageBatchTargets,
} from "@loomic/shared";

import type { AuthenticatedUser } from "../../supabase/user.js";
import {
  type BillingGuard,
  imagePayloadSchema,
  storedOutputOptions,
} from "../xy2api/billing-guard.js";
import type { JobService } from "./job-service.js";

/**
 * Pictures from one description: the jobs behind POST
 * /api/jobs/image-generation/batch, and since 第 69 条 also behind the
 * design assistant's run_workflow (a 生成 node run from the chat), so both
 * queue, number, place and bill a run the same way.
 *
 * `count` of one model, or `targets` (多模型, 第 56 条). Each picture is its
 * own job and its own main-site request (and charge); they share batch_id in
 * the payload and are numbered across the targets. With a canvas, slot i of
 * `canvas_slots` is picture i's place and `canvas_source_id` the node it
 * comes from (the worker draws the edge).
 */

/** Jobs of one batch created at once (database round trips in parallel). */
const CREATE_CHUNK = 8;

export function titleOf(payload: { title?: string | undefined }): {
  title?: string;
} {
  return payload.title ? { title: payload.title } : {};
}

export function canvasPlacement(
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

export class ImageBatchSlotsError extends Error {
  constructor() {
    super("canvas_slots needs one slot per picture");
    this.name = "ImageBatchSlotsError";
  }
}

export async function createImageBatchJobs(
  deps: { billing: BillingGuard; jobService: JobService },
  user: AuthenticatedUser,
  workspaceId: string,
  body: CreateImageBatchRequest,
): Promise<{ batchId: string; requested: number; jobs: BackgroundJob[] }> {
  const targets = imageBatchTargets(body);
  const { count: _count, targets: _targets, key_id: _key, ...payload } = body;
  const total = targets.reduce((sum, target) => sum + target.count, 0);
  if (payload.canvas_slots && payload.canvas_slots.length < total)
    throw new ImageBatchSlotsError();
  const batchId = randomUUID();
  const jobs = await deps.billing.withUserLock(user.id, async () => {
    const prepared = await deps.billing.prepareImageJobs(
      user,
      payload,
      targets,
    );
    // One job per picture, numbered across the targets. Created a few at a
    // time (a click can ask for hundreds since 第 57 条), in order.
    const plan = prepared.flatMap((target) => {
      const input = imagePayloadSchema.parse({
        ...payload,
        model: target.model,
        resolution: target.resolution,
        quality: target.quality,
        aspect_ratio: target.aspect_ratio,
        ...storedOutputOptions(target),
      });
      return Array.from({ length: target.count }, () => ({
        keyId: target.keyId,
        input,
      }));
    });
    const create = (
      keyId: number,
      input: (typeof plan)[number]["input"],
      index: number,
    ) =>
      deps.jobService.createJob(user, {
        workspaceId,
        jobType: "image_generation",
        xy2apiKeyId: keyId,
        ...(payload.project_id ? { projectId: payload.project_id } : {}),
        ...(payload.canvas_id ? { canvasId: payload.canvas_id } : {}),
        ...(payload.session_id ? { sessionId: payload.session_id } : {}),
        ...(payload.thread_id ? { threadId: payload.thread_id } : {}),
        payload: {
          ...input,
          ...titleOf(payload),
          ...canvasPlacement(payload, index),
          ...imageBatchPayloadSchema.parse({
            batch_id: batchId,
            batch_index: index,
            batch_size: total,
          }),
        },
      });
    const created: BackgroundJob[] = [];
    for (let start = 0; start < plan.length; start += CREATE_CHUNK) {
      const chunk = plan.slice(start, start + CREATE_CHUNK);
      const results = await Promise.allSettled(
        chunk.map((item, offset) =>
          create(item.keyId, item.input, start + offset),
        ),
      );
      // Every job that was created is real and will be sent: keep them all
      // (in order). Nothing is sent at creation, so stopping after a failed
      // chunk costs nothing; the caller says how many were queued.
      for (const result of results)
        if (result.status === "fulfilled") created.push(result.value);
      const failure = results.find((r) => r.status === "rejected") as
        | PromiseRejectedResult
        | undefined;
      if (failure) {
        if (created.length === 0) throw failure.reason;
        console.error(
          `[jobs] batch ${batchId}: created ${created.length} of ${total}, the rest failed to queue`,
        );
        break;
      }
    }
    return created;
  });
  console.log(
    `[jobs] batch ${batchId} of user ${user.id}: ${jobs.length}/${total} queued${targets.length > 1 ? ` across ${targets.length} models` : ""}`,
  );
  return { batchId, requested: total, jobs };
}
