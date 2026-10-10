import type { BackgroundJob } from "@loomic/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ExecutorContext,
  registerExecutor,
} from "./features/jobs/job-executor.js";
import {
  BillingGuardError,
  DeliveryPendingError,
} from "./features/xy2api/errors.js";
import type { PgmqMessage } from "./queue/pgmq-client.js";
import { processMessage } from "./worker-message.js";

afterEach(() => vi.restoreAllMocks());
function fixture(status = "queued", billing_status = "none") {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const execute = vi.fn(async () => ({ asset_id: "asset-1" }));
  registerExecutor("image_generation", execute);
  const job = { status, billing_status };
  const ctx = {
    jobService: {
      getJobAdmin: vi.fn(async () => job as BackgroundJob),
      incrementAttempt: vi.fn(async () => ({
        attempt_count: 1,
        max_attempts: 1,
      })),
      markRunning: vi.fn(async () => {
        job.status = "running";
      }),
      markSucceeded: vi.fn(async () => {
        job.status = "succeeded";
      }),
      markDeadLetter: vi.fn(async () => {
        job.status = "dead_letter";
      }),
      markRetrying: vi.fn(async () => {
        job.status = "queued";
      }),
    },
    pgmq: {
      archive: vi.fn(async () => {}),
      deleteMsg: vi.fn(async () => {}),
      setVt: vi.fn(async () => {}),
    },
    deliveries: { remove: vi.fn(async () => {}) },
  } as unknown as ExecutorContext;
  const msg = {
    msg_id: 17,
    read_ct: 1,
    enqueued_at: new Date().toISOString(),
    vt: new Date().toISOString(),
    message: { job_id: "job-1", job_type: "image_generation" },
  } as PgmqMessage;
  const run = () => processMessage("image_generation_jobs", msg, ctx, "[test]");
  return { ctx, run, execute, job };
}

describe("worker completion and redelivery", () => {
  it("keeps a succeeded job when queue acknowledgement fails and archives redelivery without execution", async () => {
    const f = fixture();
    vi.mocked(f.ctx.pgmq.deleteMsg).mockRejectedValueOnce(
      new Error("queue offline"),
    );
    await expect(f.run()).rejects.toThrow("queue offline");
    expect(f.job.status).toBe("succeeded");
    expect(f.ctx.jobService.markDeadLetter).not.toHaveBeenCalled();
    await f.run();
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.ctx.pgmq.archive).toHaveBeenCalledOnce();
  });
  it("leaves a result persistence failure unacknowledged for durable billing reconciliation", async () => {
    const f = fixture();
    vi.mocked(f.ctx.jobService.markSucceeded).mockRejectedValueOnce(
      new Error("database offline"),
    );
    await expect(f.run()).rejects.toThrow("database offline");
    expect(f.ctx.jobService.markDeadLetter).not.toHaveBeenCalled();
    expect(f.ctx.pgmq.deleteMsg).not.toHaveBeenCalled();
    expect(f.ctx.pgmq.archive).not.toHaveBeenCalled();
  });
  it("records executor failure before archive without automatic retry", async () => {
    const f = fixture();
    f.execute.mockRejectedValue(new BillingGuardError("storage_failed", 502));
    await f.run();
    expect(f.ctx.jobService.markDeadLetter).toHaveBeenCalledWith(
      "job-1",
      "storage_failed",
      expect.any(String),
    );
    expect(f.ctx.pgmq.archive).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledOnce();
  });
  it("keeps a held image's message for the next storage attempt", async () => {
    const f = fixture();
    f.execute.mockRejectedValue(new DeliveryPendingError(30));
    await f.run();
    expect(f.ctx.jobService.markRetrying).toHaveBeenCalledWith(
      "job-1",
      "storage_retrying",
      expect.any(String),
    );
    expect(f.ctx.pgmq.setVt).toHaveBeenCalledWith(
      "image_generation_jobs",
      17,
      30,
    );
    expect(f.ctx.jobService.markDeadLetter).not.toHaveBeenCalled();
    expect(f.ctx.pgmq.archive).not.toHaveBeenCalled();
    expect(f.ctx.pgmq.deleteMsg).not.toHaveBeenCalled();
    expect(f.job.status).toBe("queued");
  });
  it("removes a held image only after its redelivered job is recorded as succeeded", async () => {
    const f = fixture("queued", "charged");
    vi.mocked(f.ctx.jobService.markSucceeded).mockRejectedValueOnce(
      new Error("database offline"),
    );
    await expect(f.run()).rejects.toThrow("database offline");
    expect(f.ctx.deliveries?.remove).not.toHaveBeenCalled();
    await f.run();
    expect(f.ctx.deliveries?.remove).toHaveBeenCalledWith("job-1");
    expect(f.ctx.pgmq.deleteMsg).toHaveBeenCalledOnce();
  });
  it("does not touch held images for a first delivery", async () => {
    const f = fixture();
    await f.run();
    expect(f.ctx.deliveries?.remove).not.toHaveBeenCalled();
  });
  it("keeps a job stopped before it was sent canceled, not failed", async () => {
    const f = fixture();
    // An agent run stopped between this worker's status check and the
    // dispatch: the runner refuses the canceled job.
    f.execute.mockImplementation(async () => {
      f.job.status = "canceled";
      throw new BillingGuardError("invalid_input");
    });
    await f.run();
    expect(f.ctx.jobService.markDeadLetter).not.toHaveBeenCalled();
    expect(f.ctx.pgmq.archive).toHaveBeenCalledOnce();
    expect(f.job.status).toBe("canceled");
  });
  it("still records the failure of a canceled job that was already sent", async () => {
    const f = fixture();
    f.execute.mockImplementation(async () => {
      Object.assign(f.job, { status: "canceled", billing_status: "unknown" });
      throw new BillingGuardError("upstream_unknown", 502);
    });
    await f.run();
    expect(f.ctx.jobService.markDeadLetter).toHaveBeenCalledWith(
      "job-1",
      "upstream_unknown",
      expect.any(String),
    );
  });
  it.each(["succeeded", "dead_letter", "canceled"])(
    "archives a %s delivery without sending another request",
    async (status) => {
      const f = fixture(status);
      await f.run();
      expect(f.execute).not.toHaveBeenCalled();
      expect(f.ctx.jobService.incrementAttempt).not.toHaveBeenCalled();
      expect(f.ctx.pgmq.archive).toHaveBeenCalledOnce();
    },
  );
});

describe("per-user dispatch gate", () => {
  function gated(
    decision: "claimed" | "busy" | "not_queued",
    status = "queued",
    billing_status = "none",
  ) {
    const f = fixture(status, billing_status);
    const claim = vi.fn(async () => {
      if (decision === "claimed") f.job.status = "running";
      return decision;
    });
    Object.assign(f.ctx, {
      dispatchGate: { claim, close: vi.fn() },
      env: { maxConcurrentJobs: 2 },
    });
    return { ...f, claim };
  }
  it("leaves a job queued and unsent while the user has the limit in flight", async () => {
    const f = gated("busy");
    await f.run();
    expect(f.claim).toHaveBeenCalledWith("job-1", 2);
    expect(f.ctx.pgmq.setVt).toHaveBeenCalledWith(
      "image_generation_jobs",
      17,
      3,
    );
    expect(f.ctx.jobService.incrementAttempt).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.job.status).toBe("queued");
    expect(f.ctx.pgmq.archive).not.toHaveBeenCalled();
  });
  it("sends a claimed job once", async () => {
    const f = gated("claimed");
    await f.run();
    expect(f.ctx.jobService.incrementAttempt).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.job.status).toBe("succeeded");
  });
  it("drops a job canceled between the read and the gate without sending it", async () => {
    const f = gated("not_queued");
    vi.mocked(f.ctx.jobService.getJobAdmin)
      .mockResolvedValueOnce({
        status: "queued",
        billing_status: "none",
      } as BackgroundJob)
      .mockResolvedValueOnce({
        status: "canceled",
        billing_status: "none",
      } as BackgroundJob);
    await f.run();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.ctx.jobService.incrementAttempt).not.toHaveBeenCalled();
    expect(f.ctx.pgmq.archive).toHaveBeenCalledOnce();
  });
  it("lets held images and running redeliveries past the gate", async () => {
    const held = gated("busy", "queued", "charged");
    await held.run();
    expect(held.claim).not.toHaveBeenCalled();
    expect(held.execute).toHaveBeenCalledOnce();
    const redelivered = gated("busy", "running", "pending");
    await redelivered.run();
    expect(redelivered.claim).not.toHaveBeenCalled();
    expect(redelivered.execute).toHaveBeenCalledOnce();
  });
});
