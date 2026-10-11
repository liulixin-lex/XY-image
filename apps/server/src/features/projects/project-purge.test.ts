import { describe, expect, it, vi } from "vitest";
import { PURGE_AFTER_MS, purgeDeletedProjects } from "./project-purge.js";

const WS = "62bcdca6-40f1-4100-ab63-14fca67032dd";
const NOW = Date.UTC(2026, 9, 12);

function store(projects: Array<{ id: string; workspaceId: string; paths: string[] }>) {
  return {
    due: vi.fn(async () => projects),
    remove: vi.fn(async () => true),
  };
}

describe("purgeDeletedProjects (FINDINGS S2)", () => {
  it("removes the project's files, then the project, a day after it was deleted", async () => {
    const db = store([
      { id: "p1", workspaceId: WS, paths: [`${WS}/1-ref.png`, `${WS}/p1/thumbnail.webp`, `${WS}/1-ref.png`] },
    ]);
    const remove = vi.fn(async () => ({ error: null }));
    const counts = await purgeDeletedProjects({ store: db, remove, now: () => NOW });
    expect(db.due).toHaveBeenCalledWith(new Date(NOW - PURGE_AFTER_MS), 50);
    expect(remove).toHaveBeenCalledWith([`${WS}/1-ref.png`, `${WS}/p1/thumbnail.webp`]);
    expect(db.remove).toHaveBeenCalledWith("p1", new Date(NOW - PURGE_AFTER_MS));
    expect(counts).toEqual({ due: 1, purged: 1, files: 2, failed: 0 });
  });
  it("keeps the project when its files could not be removed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = store([{ id: "p1", workspaceId: WS, paths: [`${WS}/1-ref.png`] }]);
    const remove = vi.fn(async () => ({ error: { message: "storage down" } }));
    const counts = await purgeDeletedProjects({ store: db, remove, now: () => NOW });
    expect(db.remove).not.toHaveBeenCalled();
    expect(counts).toMatchObject({ purged: 0, failed: 1 });
  });
  it("never touches another workspace's folder and does nothing in a dry run", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const db = store([{ id: "p1", workspaceId: WS, paths: ["69aba91c-13e4-4b93-8134-4cfcd97a1d30/x.png"] }]);
    const remove = vi.fn(async () => ({ error: null }));
    await purgeDeletedProjects({ store: db, remove, now: () => NOW });
    expect(remove).not.toHaveBeenCalled();
    expect(db.remove).toHaveBeenCalledTimes(1);
    const dry = store([{ id: "p2", workspaceId: WS, paths: [`${WS}/a.png`] }]);
    await purgeDeletedProjects({ store: dry, remove, dryRun: true, now: () => NOW });
    expect(dry.remove).not.toHaveBeenCalled();
  });
});
