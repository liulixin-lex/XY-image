import { describe, expect, it, vi } from "vitest";
import { type DueWork, PURGE_AFTER_MS, RECHECK_MS, purgeDeletedWorks } from "./deleted-works-purge.js";

const WS = "62bcdca6-40f1-4100-ab63-14fca67032dd";
const OTHER = "69aba91c-13e4-4b93-8134-4cfcd97a1d30";
const NOW = Date.UTC(2026, 9, 12);
const BEFORE = new Date(NOW - PURGE_AFTER_MS);

function store(works: DueWork[]) {
  return {
    due: vi.fn(async () => works),
    finish: vi.fn(async () => true),
    keep: vi.fn(async () => true),
  };
}

const picture = (jobId: string, extra: Partial<DueWork> = {}): DueWork => ({
  jobId,
  workspaceId: WS,
  paths: [`${WS}/generated/${jobId}.png`, `${WS}/generated/${jobId}.thumb.webp`],
  inUse: false,
  ...extra,
});

describe("purgeDeletedWorks (第 58 条)", () => {
  it("removes the picture and its thumbnail a day after the delete", async () => {
    const db = store([picture("j1")]);
    const remove = vi.fn(async () => ({ error: null }));
    const counts = await purgeDeletedWorks({ store: db, remove, now: () => NOW });
    expect(db.due).toHaveBeenCalledWith(BEFORE, new Date(NOW - RECHECK_MS), 200);
    expect(remove).toHaveBeenCalledWith([`${WS}/generated/j1.png`, `${WS}/generated/j1.thumb.webp`]);
    expect(db.finish).toHaveBeenCalledWith("j1", BEFORE, [
      `${WS}/generated/j1.png`,
      `${WS}/generated/j1.thumb.webp`,
    ]);
    expect(counts).toEqual({ due: 1, removed: 1, kept: 0, files: 2, failed: 0 });
  });

  it("keeps a picture a canvas or chat still uses, to look again next week", async () => {
    const db = store([picture("j1", { inUse: true })]);
    const remove = vi.fn(async () => ({ error: null }));
    const counts = await purgeDeletedWorks({ store: db, remove, now: () => NOW });
    expect(remove).not.toHaveBeenCalled();
    expect(db.keep).toHaveBeenCalledWith("j1", BEFORE);
    // Not purged: it comes back once the canvas no longer uses it.
    expect(db.finish).not.toHaveBeenCalled();
    expect(counts).toMatchObject({ removed: 0, kept: 1 });
  });

  it("retries next run when storage refuses", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = store([picture("j1")]);
    const remove = vi.fn(async () => ({ error: { message: "storage down" } }));
    const counts = await purgeDeletedWorks({ store: db, remove, now: () => NOW });
    expect(db.finish).not.toHaveBeenCalled();
    expect(counts).toMatchObject({ removed: 0, failed: 1 });
  });

  it("only touches the workspace's generated/ folder and does nothing in a dry run", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const db = store([
      picture("j1", { paths: [`${OTHER}/generated/j1.png`, `${WS}/canvas-files/c/j1.png`] }),
    ]);
    const remove = vi.fn(async () => ({ error: null }));
    await purgeDeletedWorks({ store: db, remove, now: () => NOW });
    expect(remove).not.toHaveBeenCalled();
    expect(db.finish).toHaveBeenCalledWith("j1", BEFORE, []);

    const dry = store([picture("j2")]);
    await purgeDeletedWorks({ store: dry, remove, dryRun: true, now: () => NOW });
    expect(dry.finish).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
