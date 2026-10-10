import type { BackgroundJobType } from "@loomic/shared";
import { DISPATCH_RETRY_SECONDS } from "./features/jobs/dispatch-gate.js";
import {
  type ExecutorContext,
  getExecutor,
} from "./features/jobs/job-executor.js";
import {
  BillingGuardError,
  DeliveryPendingError,
} from "./features/xy2api/errors.js";
import type { PgmqMessage } from "./queue/pgmq-client.js";

const TERMINAL: string[] = ["succeeded", "dead_letter", "canceled"];

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

  let current = await ctx.jobService.getJobAdmin(jobId);
  if (TERMINAL.includes(current.status)) {
    await ctx.pgmq.archive(queue, msg.msg_id);
    return;
  }

  // Per-user dispatch gate: a queued, unsent image job waits here while the
  // user already has LOOMIC_MAX_CONCURRENT_JOBS at the main site. It stays
  // queued (still free to cancel) and comes back in a few seconds; nothing
  // is counted as an attempt. Held images (charged) and redeliveries of a
  // job already running skip it: they do not send a new request.
  if (
    ctx.dispatchGate &&
    jobType === "image_generation" &&
    current.status === "queued" &&
    current.billing_status !== "charged"
  ) {
    const decision = await ctx.dispatchGate.claim(
      jobId,
      ctx.env.maxConcurrentJobs,
    );
    if (decision === "busy") {
      await ctx.pgmq.setVt(queue, msg.msg_id, DISPATCH_RETRY_SECONDS);
      // Once on the first wait and then about every minute, not every 3 s.
      if (msg.read_ct <= 1 || msg.read_ct % 20 === 0)
        console.log(
          `${tag} Job ${jobId} waiting: user has ${ctx.env.maxConcurrentJobs} image requests in flight (read ${msg.read_ct})`,
        );
      return;
    }
    if (decision === "not_queued") {
      // Canceled (or finished) between the read above and the gate.
      current = await ctx.jobService.getJobAdmin(jobId);
      if (TERMINAL.includes(current.status)) {
        await ctx.pgmq.archive(queue, msg.msg_id);
        console.log(`${tag} Job ${jobId} ${current.status} before dispatch`);
        return;
      }
    }
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
