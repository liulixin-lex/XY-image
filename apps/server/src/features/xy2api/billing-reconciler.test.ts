import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECONCILE_SETTLE_MS,
  type ReconcileStore,
  type UnsettledJob,
  createBillingReconciler,
  reconcileJob,
} from "./billing-reconciler.js";
import type { UsageLookup, UsageMatch } from "./client.js";
import { BillingGuardError, Xy2apiError } from "./errors.js";

afterEach(() => vi.restoreAllMocks());

const ended = new Date("2026-10-09T10:00:00Z");
const job = (over: Partial<UnsettledJob> = {}): UnsettledJob => ({
  id: "job-1",
  userId: "user-1",
  keyId: 7,
  requestId: "req-1",
  createdAt: new Date(ended.getTime() - 60_000),
  endedAt: ended,
  ...over,
});
function deps(
  lookups: Array<UsageLookup | UsageMatch | Error>,
  nowMs = ended.getTime(),
) {
  const findUsage = vi.fn(async () => {
    const next = lookups.shift();
    if (!next) throw new Error("unexpected lookup");
    if (next instanceof Error) throw next;
    return next as UsageLookup;
  });
  const findUsageByShape = vi.fn(async () => {
    const next = lookups.shift();
    if (!next) throw new Error("unexpected lookup");
    if (next instanceof Error) throw next;
    return next as UsageMatch;
  });
  const store: ReconcileStore = {
    claim: vi.fn(async () => []),
    settle: vi.fn(async () => true),
    attributedRequestIds: vi.fn(async () => new Set(["twin-ok"])),
    close: vi.fn(async () => {}),
  };
  return {
    store,
    client: { findUsage, findUsageByShape },
    accounts: {
      withAccess: <T>(_user: string, fn: (token: string) => Promise<T>) =>
        fn("synthetic-access"),
    },
    now: () => nowMs,
  };
}

describe("待核对 reconciliation", () => {
  it("marks the job charged when its usage row exists", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const d = deps([{ kind: "found", usageId: 5, actualCost: 0.04 }]);
    expect(await reconcileJob(job(), d)).toBe("charged");
    expect(d.store.settle).toHaveBeenCalledWith("job-1", "charged");
    expect(d.client.findUsage).toHaveBeenCalledWith("synthetic-access", {
      requestId: "req-1",
      apiKeyId: 7,
      from: new Date("2026-10-08T09:59:00Z"),
      to: new Date("2026-10-10T10:00:00Z"),
    });
  });
  it("waits while the job is young, then settles not charged", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const young = deps([{ kind: "absent" }], ended.getTime() + 3_600_000);
    expect(await reconcileJob(job(), young)).toBe("waiting");
    expect(young.store.settle).not.toHaveBeenCalled();
    const old = deps(
      [{ kind: "absent" }],
      ended.getTime() + RECONCILE_SETTLE_MS,
    );
    expect(await reconcileJob(job(), old)).toBe("not_charged");
    expect(old.store.settle).toHaveBeenCalledWith("job-1", "not_charged");
  });
  it("never concludes not charged from an incomplete scan", async () => {
    const d = deps(
      [{ kind: "incomplete" }],
      ended.getTime() + 3 * RECONCILE_SETTLE_MS,
    );
    expect(await reconcileJob(job(), d)).toBe("waiting");
    expect(d.store.settle).not.toHaveBeenCalled();
  });
  it("searches all of the user's rows when the key was deleted", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const d = deps([
      new Xy2apiError(404, "API_KEY_NOT_FOUND"),
      { kind: "found", usageId: null, actualCost: null },
    ]);
    expect(await reconcileJob(job(), d)).toBe("charged");
    expect(d.client.findUsage).toHaveBeenLastCalledWith(
      "synthetic-access",
      expect.not.objectContaining({ apiKeyId: expect.anything() }),
    );
  });
  it("skips the rest of a user's jobs after a rate limit or lost session", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deps([
      new Xy2apiError(429, "RATE_LIMITED"),
      new BillingGuardError("xy2api_reauth_required", 401),
      { kind: "found", usageId: 1, actualCost: 0.04 },
    ]);
    vi.mocked(d.store.claim).mockResolvedValue([
      job({ id: "a1", userId: "a" }),
      job({ id: "a2", userId: "a" }),
      job({ id: "b1", userId: "b" }),
      job({ id: "b2", userId: "b" }),
      job({ id: "c1", userId: "c" }),
    ]);
    const counts = await createBillingReconciler(d).sweep();
    expect(counts).toEqual({
      charged: 1,
      not_charged: 0,
      waiting: 0,
      skipped: 4,
    });
    expect(d.client.findUsage).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.join(" ")).not.toContain("synthetic-access");
  });
});

// FINDINGS G7/R1 (gguuai.com 2026-10-11): Cloudflare cut a 4K call after
// 125 s, and a worker was killed mid-call. Both were billed, neither job has
// xy2api's request id.
describe("待核对 reconciliation without a request id", () => {
  const started = new Date(ended.getTime() - 125_000);
  const idless = (over: Partial<UnsettledJob> = {}) =>
    job({
      requestId: null,
      model: "gpt-image-2",
      resolution: "4K",
      startedAt: started,
      createdAt: new Date(started.getTime() - 1_000),
      ...over,
    });
  it("settles charged on the one row of its shape and keeps its id", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const d = deps([
      { kind: "found", usageId: 9, actualCost: 0.1, requestId: "862ee3fc" },
    ]);
    expect(await reconcileJob(idless(), d)).toBe("charged");
    expect(d.store.settle).toHaveBeenCalledWith("job-1", "charged", "862ee3fc");
    expect(d.client.findUsage).not.toHaveBeenCalled();
    expect(d.client.findUsageByShape).toHaveBeenCalledWith("synthetic-access", {
      apiKeyId: 7,
      model: "gpt-image-2",
      imageSize: "4K",
      // enqueue minus 2 minutes of clock skew … failure plus 30 minutes
      after: new Date(started.getTime() - 1_000 - 120_000),
      before: new Date(ended.getTime() + 30 * 60_000),
      exclude: new Set(["twin-ok"]),
    });
  });
  it("draws no conclusion from several rows of the same shape", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deps(
      [{ kind: "ambiguous", candidates: 2 }],
      ended.getTime() + 2 * RECONCILE_SETTLE_MS,
    );
    expect(await reconcileJob(idless(), d)).toBe("waiting");
    expect(d.store.settle).not.toHaveBeenCalled();
    expect(warn.mock.calls.join(" ")).toContain("2 usage rows");
  });
  it("settles not charged only after a day without such a row", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const young = deps([{ kind: "absent" }], ended.getTime() + 3_600_000);
    expect(await reconcileJob(idless(), young)).toBe("waiting");
    const old = deps([{ kind: "absent" }], ended.getTime() + RECONCILE_SETTLE_MS);
    expect(await reconcileJob(idless(), old)).toBe("not_charged");
    expect(old.store.settle).toHaveBeenCalledWith("job-1", "not_charged");
  });
  it("leaves a job it cannot describe alone", async () => {
    const d = deps([]);
    expect(await reconcileJob(idless({ model: null }), d)).toBe("waiting");
    expect(await reconcileJob(idless({ startedAt: null }), d)).toBe("waiting");
    expect(d.client.findUsageByShape).not.toHaveBeenCalled();
  });
});
