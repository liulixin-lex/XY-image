import { afterEach, describe, expect, it, vi } from "vitest";
import { SWEEP_GRACE_MS, sweepCanvasFiles } from "./canvas-files-sweeper.js";

afterEach(() => vi.restoreAllMocks());

const names = (workspace: string, count: number) =>
  Array.from(
    { length: count },
    (_, index) => `${workspace}/canvas-files/canvas-1/f${index}.png`,
  );

function fixture(orphans: Record<string, string[]>) {
  const asked: Array<{ workspace: string; before: Date; limit: number }> = [];
  const store = {
    workspaces: async () => Object.keys(orphans),
    orphans: async (workspace: string, before: Date, limit: number) => {
      asked.push({ workspace, before, limit });
      return (orphans[workspace] ?? []).slice(0, limit);
    },
  };
  const removed: string[][] = [];
  const remove = vi.fn(
    async (paths: string[]): Promise<{ error: { message: string } | null }> => {
      removed.push(paths);
      return { error: null };
    },
  );
  return { store, remove, removed, asked };
}

describe("canvas files sweep", () => {
  it("removes unreferenced objects older than the grace period, in batches", async () => {
    const f = fixture({ w1: names("w1", 150), w2: names("w2", 2) });
    const now = Date.parse("2026-10-09T12:00:00Z");
    const counts = await sweepCanvasFiles({ ...f, now: () => now });
    expect(counts).toEqual({
      workspaces: 2,
      orphaned: 152,
      removed: 152,
      failed: 0,
    });
    expect(f.removed.map((batch) => batch.length)).toEqual([100, 50, 2]);
    expect(f.asked[0]?.before.getTime()).toBe(now - SWEEP_GRACE_MS);
  });

  it("only lists them in a dry run", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const f = fixture({ w1: names("w1", 3) });
    const counts = await sweepCanvasFiles({ ...f, dryRun: true });
    expect(counts).toMatchObject({ orphaned: 3, removed: 0 });
    expect(f.remove).not.toHaveBeenCalled();
  });

  it("stops at the per-sweep limit", async () => {
    const f = fixture({ w1: names("w1", 150), w2: names("w2", 5) });
    const counts = await sweepCanvasFiles({ ...f, maxRemovals: 120 });
    expect(counts).toMatchObject({
      workspaces: 1,
      orphaned: 120,
      removed: 120,
    });
    expect(f.asked.map((a) => [a.workspace, a.limit])).toEqual([["w1", 120]]);
  });

  it("counts a failed delete and goes on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fixture({ w1: names("w1", 2), w2: names("w2", 1) });
    f.remove.mockResolvedValueOnce({ error: { message: "storage down" } });
    const counts = await sweepCanvasFiles(f);
    expect(counts).toMatchObject({ orphaned: 3, removed: 1, failed: 2 });
    expect(String(warn.mock.calls[0]?.[0])).toContain("storage down");
  });
});
