import assert from "node:assert/strict";
import { test } from "node:test";
import { backupTime, planRetention } from "./hot-backup.mjs";

const at = (iso) => `hot-${iso.replace(/[:.]/g, "-")}`;

test("backup names round-trip and anything else is ignored", () => {
  assert.equal(backupTime(at("2026-10-11T03:00:00.000Z")).toISOString(), "2026-10-11T03:00:00.000Z");
  assert.equal(backupTime("latest.json"), null);
  assert.equal(backupTime("hot-2026-10-11"), null);
});

test("retention keeps the newest of each recent day and week", () => {
  const names = [];
  // Daily at 03:00 for 40 days, plus a manual second backup on the last day.
  for (let day = 0; day < 40; day++)
    names.push(at(new Date(Date.UTC(2026, 8, 2 + day, 3)).toISOString()));
  names.push(at("2026-10-11T15:00:00.000Z"), "latest.json", "notes");
  const removed = planRetention(names, 7, 4);
  const kept = names.filter((n) => !removed.includes(n) && backupTime(n));
  assert.ok(kept.includes(at("2026-10-11T15:00:00.000Z")), "newest kept");
  assert.ok(!kept.includes(at("2026-10-11T03:00:00.000Z")), "older one of the same day goes");
  // 7 days + up to 4 weekly (some coincide with the daily ones).
  assert.ok(kept.length >= 7 && kept.length <= 11, String(kept.length));
  assert.ok(!removed.includes("latest.json") && !removed.includes("notes"));
  assert.ok(removed.includes(at("2026-09-02T03:00:00.000Z")));
});

test("a single backup is always kept", () => {
  assert.deepEqual(planRetention([at("2026-10-11T03:00:00.000Z")], 1, 1), []);
});
