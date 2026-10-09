import { describe, expect, it } from "vitest";
import { isReady } from "./readiness.js";

const all = {
  database: true,
  schema: true,
  queue: true,
  storage: true,
  realtime: true,
  permissions: true,
  auth: true,
  storageApi: true,
};

describe("readiness", () => {
  it("stays ready without the Realtime publication", () => {
    expect(isReady({ ...all, realtime: false })).toBe(true);
  });
  it.each(Object.keys(all).filter((name) => name !== "realtime"))(
    "fails when %s fails",
    (name) => {
      expect(isReady({ ...all, [name]: false })).toBe(false);
    },
  );
});
