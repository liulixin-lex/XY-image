import type { AdminSupabaseClient } from "../../supabase/admin.js";

/**
 * Settles agent runs a crash left 'accepted' / 'running' (FINDINGS A5). A
 * graceful API restart waits for its runs (lifecycle/drain-tasks.ts), so
 * only a killed process leaves them. No run lasts an hour (the longest seen
 * in production, three pictures one by one, took 5.5 minutes), so older
 * ones are marked failed / interrupted. Runs on start and every 15 minutes;
 * safe with several API processes: it only touches runs no process could
 * still be serving.
 */
export const STALE_RUN_MS = 60 * 60 * 1000;
const SWEEP_MS = 15 * 60 * 1000;

export async function sweepStaleRuns(
  admin: AdminSupabaseClient,
  now = Date.now(),
): Promise<number> {
  const { data, error } = await admin
    .from("agent_runs")
    .update({
      status: "failed",
      error_code: "interrupted",
      error_message: "运行中断，没有完成",
      completed_at: new Date(now).toISOString(),
    })
    .in("status", ["accepted", "running"])
    .lt("created_at", new Date(now - STALE_RUN_MS).toISOString())
    .select("id");
  if (error) throw new Error(`agent_runs sweep failed: ${error.message}`);
  return data?.length ?? 0;
}

export function startStaleRunSweeper(getAdmin: () => AdminSupabaseClient) {
  const sweep = () =>
    sweepStaleRuns(getAdmin())
      .then((count) => {
        if (count)
          console.warn(
            `[agent-runs] marked ${count} run(s) left running for over an hour as interrupted`,
          );
      })
      .catch((error) =>
        console.error(
          `[agent-runs] stale run sweep failed: ${error instanceof Error ? error.message : "unknown"}`,
        ),
      );
  const first = setTimeout(sweep, 30_000);
  const timer = setInterval(sweep, SWEEP_MS);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
