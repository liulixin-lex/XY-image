import { describe, expect, it, vi } from "vitest";
import {
  type DiskMonitorStore,
  type OpenAlert,
  formatBytes,
  levelFor,
  percentUsed,
  sampleDisk,
} from "./disk-monitor.js";

const GB = 1024 ** 3;
const thresholds = { warnPercent: 80, criticalPercent: 90 };

function store(open: OpenAlert | null = null) {
  let current = open;
  const s = {
    measure: vi.fn(async () => ({
      dbBytes: 2 * GB,
      storageBytes: 5 * GB,
      storageByKind: { generated: 4 * GB, uploads: GB },
    })),
    record: vi.fn(async () => {}),
    openAlert: vi.fn(async () => current),
    raise: vi.fn(async (_kind: string, level: "warning" | "critical") => {
      current = {
        id: "a1",
        level,
        notifiedLevel: current?.notifiedLevel ?? null,
      };
      return "a1";
    }),
    resolve: vi.fn(async () => true),
    markNotified: vi.fn(async () => {}),
    prune: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  } satisfies DiskMonitorStore;
  return s;
}

const disk = (usedGb: number, availGb: number) => async () => ({
  totalBytes: (usedGb + availGb + 5) * GB,
  usedBytes: usedGb * GB,
  availBytes: availGb * GB,
});

describe("disk monitor (第 59 条)", () => {
  it("measures like df and picks the level with hysteresis", () => {
    expect(
      percentUsed({ totalBytes: 110, usedBytes: 50, availBytes: 50 }),
    ).toBe(50);
    expect(levelFor(79, thresholds, null)).toBeNull();
    expect(levelFor(80, thresholds, null)).toBe("warning");
    expect(levelFor(95, thresholds, "warning")).toBe("critical");
    // Open warning stays until clearly below the line.
    expect(levelFor(79, thresholds, "warning")).toBe("warning");
    expect(levelFor(77.9, thresholds, "warning")).toBeNull();
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(149 * GB)).toBe("149 GB");
  });

  it("records a sample and stays quiet below the threshold", async () => {
    const db = store();
    const notify = vi.fn(async () => {});
    const result = await sampleDisk({
      store: db,
      read: disk(166, 149),
      ...thresholds,
      objectStorage: "local",
      notify,
    });
    expect(db.record).toHaveBeenCalledWith(
      expect.objectContaining({
        usedBytes: 166 * GB,
        dbBytes: 2 * GB,
        objectStorage: "local",
      }),
    );
    expect(db.prune).toHaveBeenCalled();
    expect(result.level).toBeNull();
    expect(db.raise).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("opens a warning once, escalates to critical, then resolves", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const db = store();
    const notify = vi.fn(async () => {});
    await sampleDisk({
      store: db,
      read: disk(85, 15),
      ...thresholds,
      objectStorage: "local",
      notify,
    });
    expect(db.raise).toHaveBeenLastCalledWith(
      "disk",
      "warning",
      expect.stringContaining("超过 80%"),
      85,
      80,
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(db.markNotified).toHaveBeenCalledWith("a1", "warning");

    // Same level again: updated, not sent again.
    const again = store({
      id: "a1",
      level: "warning",
      notifiedLevel: "warning",
    });
    const quiet = vi.fn(async () => {});
    await sampleDisk({
      store: again,
      read: disk(86, 14),
      ...thresholds,
      objectStorage: "local",
      notify: quiet,
    });
    expect(again.raise).toHaveBeenCalled();
    expect(quiet).not.toHaveBeenCalled();

    const worse = store({
      id: "a1",
      level: "warning",
      notifiedLevel: "warning",
    });
    const loud = vi.fn(async () => {});
    await sampleDisk({
      store: worse,
      read: disk(93, 7),
      ...thresholds,
      objectStorage: "local",
      notify: loud,
    });
    expect(worse.raise).toHaveBeenLastCalledWith(
      "disk",
      "critical",
      expect.stringContaining("请尽快清理或扩容"),
      93,
      90,
    );
    expect(loud).toHaveBeenCalledWith(
      expect.objectContaining({ level: "critical" }),
    );

    const better = store({
      id: "a1",
      level: "critical",
      notifiedLevel: "critical",
    });
    const done = vi.fn(async () => {});
    await sampleDisk({
      store: better,
      read: disk(60, 40),
      ...thresholds,
      objectStorage: "local",
      notify: done,
    });
    expect(better.resolve).toHaveBeenCalledWith("disk");
    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({ level: "resolved" }),
    );
  });

  it("without a webhook, logs an alert once and then stays quiet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = store();
    await sampleDisk({
      store: db,
      read: disk(85, 15),
      ...thresholds,
      objectStorage: "local",
    });
    expect(db.markNotified).toHaveBeenCalledWith("a1", "warning");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("keeps working when the webhook fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = store();
    const notify = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(
      sampleDisk({
        store: db,
        read: disk(95, 5),
        ...thresholds,
        objectStorage: "local",
        notify,
      }),
    ).resolves.toMatchObject({ level: "critical" });
    expect(db.markNotified).not.toHaveBeenCalled();
  });
});
