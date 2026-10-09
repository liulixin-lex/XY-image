import { bootstrap } from "global-agent";

// Enable HTTP proxy for all outbound requests if GLOBAL_AGENT_HTTP_PROXY is set
bootstrap();

// Native fetch proxy for gateway requests.
if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.GLOBAL_AGENT_HTTP_PROXY));
}

import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { loadServerEnv } from "./config/env.js";
import { validateProductionEnv } from "./config/production.js";
import type { ExecutorContext } from "./features/jobs/job-executor.js";
import { createJobService } from "./features/jobs/job-service.js";
import { createPendingDeliveryStore } from "./features/xy2api/pending-delivery.js";
import { createPgmqClient } from "./queue/pgmq-client.js";
import { createAdminSupabaseClient } from "./supabase/admin.js";
import { closeSupabaseTransport } from "./supabase/transport.js";
import { createUserSupabaseClientFactory } from "./supabase/user.js";
import { describeErrorForLog } from "./utils/error-sanitizer.js";
import { processMessage } from "./worker-message.js";

// Import executors to trigger registration via side effects
import "./features/jobs/executors/image-generation.js";

// Register only xy2api image providers, matching the API process.
import { registerAllProviders } from "./generation/providers/register-all.js";

const QUEUES = ["image_generation_jobs"] as const;

const VT_BY_QUEUE: Record<string, number> = {
  image_generation_jobs: 120,
};

async function main() {
  const env = loadServerEnv();
  validateProductionEnv(env);

  if (!env.supabaseDbUrl) {
    console.error("SUPABASE_DB_URL is required for worker process.");
    process.exit(1);
  }

  // Register all generation providers (shared with app.ts)
  registerAllProviders(env);

  const pgmq = createPgmqClient(env.supabaseDbUrl);
  const createUserClient = createUserSupabaseClientFactory(env);

  let adminClient: ReturnType<typeof createAdminSupabaseClient> | undefined;
  const getAdminClient = () => {
    adminClient ??= createAdminSupabaseClient(env);
    return adminClient;
  };

  const jobService = createJobService({
    createUserClient,
    getAdminClient,
    pgmq,
  });

  const deliveries = createPendingDeliveryStore(env.supabaseDbUrl);

  // Base context — per-message fields (queue, msgId, renewVt) are added in processMessage
  const baseCtx = {
    jobService,
    pgmq,
    getAdminClient,
    env,
    deliveries,
  };

  const CONCURRENCY_BY_QUEUE: Record<string, number> = {
    image_generation_jobs: env.workerImageConcurrency ?? 3,
  };

  const inFlightByQueue = new Map<string, Set<Promise<void>>>(
    QUEUES.map((q) => [q, new Set()]),
  );

  // Server-side long poll: wait up to N seconds inside Postgres for messages,
  // checking every 500ms. This replaces the old client-side sleep(2000) + read()
  // pattern that generated ~340K idle queries per monitoring period.
  const pollTimeoutSeconds = Math.max(
    1,
    Math.floor((env.workerPollIntervalMs ?? 5000) / 1000),
  );
  const workerId = env.workerId ?? randomUUID().slice(0, 8);
  const tag = `[worker:${workerId}]`;

  let running = true;
  let shuttingDown = false;
  let failures = 0;
  let lastHeartbeat = 0;
  const heartbeatFile = process.env.WORKER_HEARTBEAT_FILE;
  const heartbeat = async () => {
    if (!heartbeatFile || Date.now() - lastHeartbeat < 5000) return;
    await writeFile(
      heartbeatFile,
      JSON.stringify({ at: Date.now(), workerId }),
      { mode: 0o600 },
    );
    lastHeartbeat = Date.now();
  };

  // Graceful shutdown — wait for in-flight jobs then exit
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const totalInFlight = [...inFlightByQueue.values()].reduce(
      (n, s) => n + s.size,
      0,
    );
    console.log(
      `${tag} Shutting down, waiting for ${totalInFlight} in-flight jobs...`,
    );
    running = false;
    if (heartbeatFile) await unlink(heartbeatFile).catch(() => {});
    // Leave enough time for one already-sent paid request to finish and persist.
    const deadline = setTimeout(() => process.exit(1), 700_000);
    deadline.unref();
    const allTasks = [...inFlightByQueue.values()].flatMap((s) => [...s]);
    if (allTasks.length > 0) {
      await Promise.allSettled(allTasks);
    }
    await pgmq.shutdown();
    await deliveries.close();
    await closeSupabaseTransport();
    console.log(`${tag} Shutdown complete.`);
    process.exit(0);
  };
  const handleShutdown = () => {
    void shutdown().catch(() => {
      console.error(`${tag} Shutdown failed`);
      process.exit(1);
    });
  };
  process.once("SIGINT", handleShutdown);
  process.once("SIGTERM", handleShutdown);

  const concurrencyDesc = QUEUES.map(
    (q) => `${q}=${CONCURRENCY_BY_QUEUE[q] ?? 1}`,
  ).join(", ");
  console.log(
    `${tag} Started. concurrency={${concurrencyDesc}}, longPollTimeout=${pollTimeoutSeconds}s`,
  );

  while (running) {
    for (const queue of QUEUES) {
      try {
        const inFlight = inFlightByQueue.get(queue);
        if (!inFlight) continue;
        const cap = CONCURRENCY_BY_QUEUE[queue] ?? 1;
        const available = cap - inFlight.size;
        if (available <= 0) {
          await heartbeat();
          await sleep(250); // Prevent a busy loop while all slots are occupied.
          continue;
        }

        const vt = VT_BY_QUEUE[queue] ?? 120;
        const messages = await pgmq.readWithPoll(
          queue,
          vt,
          Math.min(available, env.workerMaxBatchSize ?? available),
          pollTimeoutSeconds,
          500,
        );

        if (!running) break; // A pending poll can return after SIGTERM.
        failures = 0;
        await heartbeat();
        // SIGTERM may arrive while the heartbeat write is pending.
        if (!running) {
          if (heartbeatFile) await unlink(heartbeatFile).catch(() => {});
          break;
        }
        for (const msg of messages) {
          const ctx: ExecutorContext = {
            ...baseCtx,
            queue,
            msgId: msg.msg_id,
            renewVt: async (vtSeconds: number) => {
              try {
                await pgmq.setVt(queue, msg.msg_id, vtSeconds);
              } catch (e) {
                console.warn(`[renewVt] failed for msg ${msg.msg_id}`);
              }
            },
          };
          const task = processMessage(queue, msg, ctx, tag)
            .catch(() => console.error(`${tag} Job state update failed`))
            .finally(() => inFlight.delete(task));
          inFlight.add(task);
        }
      } catch (err) {
        if (!running) break;
        failures += 1;
        const delay = Math.min(30_000, 500 * 2 ** Math.min(failures, 6));
        console.error(`${tag} Queue unavailable; retrying poll in ${delay}ms`);
        await sleep(delay); // Only polling retries. Image submissions never retry.
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  // Without the reason a crash-looping worker cannot be diagnosed; the
  // description is credential-free (see describeErrorForLog).
  console.error(
    `[worker] Fatal startup or lifecycle error: ${describeErrorForLog(err)}`,
  );
  process.exit(1);
});
