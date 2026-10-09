import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECONCILE_SETTLE_MS,
  type ReconcileStore,
  type UnsettledJob,
  createBillingReconciler,
  reconcileJob,
} from "./billing-reconciler.js";
import type { UsageLookup } from "./client.js";
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
function deps(lookups: Array<UsageLookup | Error>, nowMs = ended.getTime()) {
  const findUsage = vi.fn(async () => {
    const next = lookups.shift();
    if (!next) throw new Error("unexpected lookup");
    if (next instanceof Error) throw next;
    return next;
  });
  const store: ReconcileStore = {
    claim: vi.fn(async () => []),
    settle: vi.fn(async () => true),
    close: vi.fn(async () => {}),
  };
  return {
    store,
    client: { findUsage },
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
