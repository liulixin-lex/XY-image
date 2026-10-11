import { describe, expect, it } from "vitest";
import { dispatchRetrySeconds } from "./dispatch-gate.js";

describe("dispatchRetrySeconds (FINDINGS L2)", () => {
  it("checks every 3 s at first, then backs off to 10 s", () => {
    expect([1, 5, 6, 10, 11, 50].map(dispatchRetrySeconds)).toEqual([
      3, 3, 6, 6, 10, 10,
    ]);
    expect(dispatchRetrySeconds(0)).toBe(3);
  });
});
