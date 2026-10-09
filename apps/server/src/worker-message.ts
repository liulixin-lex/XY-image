import type { BackgroundJobType } from "@loomic/shared";
import {
  type ExecutorContext,
  getExecutor,
} from "./features/jobs/job-executor.js";
import {
  BillingGuardError,
  DeliveryPendingError,
} from "./features/xy2api/errors.js";
import type { PgmqMessage } from "./queue/pgmq-client.js";

const QUEUE_TO_TYPE: Record<string, BackgroundJobType> = {
  image_generation_jobs: "image_generation",
};

export async function processMessage(
  queue: string,
  msg: PgmqMessage,
  ctx: ExecutorContext,
  tag: string,
) {
  const jobId = msg.message.job_id as string;
  const jobType =
    (msg.message.job_type as BackgroundJobType) ?? QUEUE_TO_TYPE[queue];

  if (!jobId || !jobType) {
    console.error(`${tag} Invalid queue message`);
    await ctx.pgmq.archive(queue, msg.msg_id);
    return;
  }

  // Extract traceability context from PGMQ message (if present)
  const sessionShort =
    typeof msg.message.session_id === "string"
      ? msg.message.session_id.slice(0, 8)
      : undefined;
  const startTime = Date.now();
  console.log(
    `${tag} Processing job ${jobId} (${jobType})${sessionShort ? ` session:${sessionShort}` : ""}`,
  );

  const executor = getExecutor(jobType);
  if (!executor) {
    console.error(`${tag} No executor for job type: ${jobType}`);
    await ctx.jobService.markFailed(
      jobId,
      "no_executor",
      `No executor registered for ${jobType}`,
    );
    await ctx.pgmq.archive(queue, msg.msg_id);
    return;
  }

  const current = await ctx.jobService.getJobAdmin(jobId);
  if (["succeeded", "dead_letter", "canceled"].includes(current.status)) {
    await ctx.pgmq.archive(queue, msg.msg_id);
    return;
  }
  // Increment attempt count
  await ctx.jobService.incrementAttempt(jobId);

  // Mark running
  await ctx.jobService.markRunning(jobId);

  let result: Record<string, unknown>;
  try {
    result = await executor(jobId, msg.message as Record<string, unknown>, ctx);
  } catch (err) {
    if (err instanceof DeliveryPendingError) {
      // The charged image is held in the database. Keep the message and let it
      // come back for the next storage attempt; xy2api is not called again.
      await ctx.jobService.markRetrying(jobId, err.code, err.message);
      await ctx.pgmq.setVt(queue, msg.msg_id, err.retryInSeconds);
      console.warn(
        `${tag} Job ${jobId} image held; storage retry in ${err.retryInSeconds}s`,
      );
      return;
    }
    // Stopped (an agent run, or the studio) between this worker's status
    // check and the dispatch: nothing was sent, so there is nothing to record
    // as failed or to reconcile. Keep it canceled.
    const latest = await ctx.jobService.getJobAdmin(jobId).catch(() => null);
    if (latest?.status === "canceled" && latest.billing_status === "none") {
      await ctx.pgmq.archive(queue, msg.msg_id);
      console.log(`${tag} Job ${jobId} canceled before it was sent`);
      return;
    }
    const errorCode =
      err instanceof BillingGuardError ? err.code : "upstream_unknown";
    const errorMessage =
      err instanceof BillingGuardError
        ? err.message
        : "请求状态未知，请到主站核对用量";
    await ctx.jobService.markDeadLetter(jobId, errorCode, errorMessage);
    await ctx.pgmq.archive(queue, msg.msg_id);
    console.error(`${tag} Job ${jobId} failed: ${errorCode}`);
    return;
  }

  // A persistence or queue-ack failure must never overwrite a generated result
  // with a failed job. Redelivery reads durable state and never resends billing.
  await ctx.jobService.markSucceeded(jobId, result);
  // Already charged when this delivery started: the result came from a held
  // image, whose copy can go now that success is recorded.
  if (current.billing_status === "charged")
    await ctx.deliveries?.remove(jobId).catch(() => {
      console.error(`${tag} Job ${jobId} held image not removed`);
    });
  await ctx.pgmq.deleteMsg(queue, msg.msg_id);
  console.log(`${tag} Job ${jobId} succeeded +${Date.now() - startTime}ms`);
}
