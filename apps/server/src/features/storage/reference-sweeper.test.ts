import { describe, expect, it, vi } from "vitest";
import {
  SWEEP_GRACE_MS,
  UPLOAD_NAME,
  sweepUnusedReferences,
} from "./reference-sweeper.js";

const WS = "62bcdca6-40f1-4100-ab63-14fca67032dd";
const PROJECT = "69aba91c-13e4-4b93-8134-4cfcd97a1d30";
const NOW = Date.UTC(2026, 9, 13);

function store(orphans: string[]) {
  return {
    orphans: vi.fn(async () => orphans),
    forget: vi.fn(async () => {}),
  };
}

describe("unused reference sweep (第 59 条)", () => {
  it("matches uploads only, never generated pictures, canvas files or thumbnails", () => {
    expect(UPLOAD_NAME.test(`${WS}/1760000000000-ref.png`)).toBe(true);
    expect(UPLOAD_NAME.test(`${WS}/${PROJECT}/1760000000000-chat.jpg`)).toBe(
      true,
    );
    expect(UPLOAD_NAME.test(`${WS}/generated/${PROJECT}.png`)).toBe(false);
    expect(UPLOAD_NAME.test(`${WS}/canvas-files/${PROJECT}/abc.png`)).toBe(
      false,
    );
    expect(UPLOAD_NAME.test(`${WS}/${PROJECT}/thumbnail.webp`)).toBe(false);
    expect(UPLOAD_NAME.test(`other/1760000000000-ref.png`)).toBe(false);
  });

  it("removes old unused uploads and forgets their asset rows", async () => {
    const paths = [
      `${WS}/1760000000000-a.png`,
      `${WS}/${PROJECT}/1760000000001-b.png`,
    ];
    const db = store(paths);
    const remove = vi.fn(async () => ({ error: null }));
    const counts = await sweepUnusedReferences({
      store: db,
      remove,
      now: () => NOW,
    });
    expect(db.orphans).toHaveBeenCalledWith(
      new Date(NOW - SWEEP_GRACE_MS),
      500,
    );
    expect(remove).toHaveBeenCalledWith(paths);
    expect(db.forget).toHaveBeenCalledWith(paths);
    expect(counts).toEqual({ orphaned: 2, removed: 2, failed: 0 });
  });

  it("skips anything that is not an upload, keeps rows when storage refuses, and dry runs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const db = store([`${WS}/generated/x.png`, `${WS}/1760000000000-a.png`]);
    const remove = vi.fn(async () => ({ error: { message: "storage down" } }));
    const counts = await sweepUnusedReferences({
      store: db,
      remove,
      now: () => NOW,
    });
    expect(remove).toHaveBeenCalledWith([`${WS}/1760000000000-a.png`]);
    expect(db.forget).not.toHaveBeenCalled();
    expect(counts).toEqual({ orphaned: 1, removed: 0, failed: 1 });

    const dry = store([`${WS}/1760000000000-a.png`]);
    const untouched = vi.fn(async () => ({ error: null }));
    await sweepUnusedReferences({
      store: dry,
      remove: untouched,
      dryRun: true,
      now: () => NOW,
    });
    expect(untouched).not.toHaveBeenCalled();
  });
});
