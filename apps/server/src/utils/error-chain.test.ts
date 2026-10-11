import { describe, expect, it } from "vitest";
import { causeChain, findCause } from "./error-chain.js";

class Target extends Error {}

describe("causeChain", () => {
  it("walks past any number of wrappers", () => {
    let error: Error = new Target("inner");
    for (let i = 0; i < 20; i++)
      error = new Error(`layer ${i}`, { cause: error });
    expect(
      findCause(error, (e): e is Target => e instanceof Target)?.message,
    ).toBe("inner");
    expect([...causeChain(error)]).toHaveLength(21);
  });

  it("stops at a cycle and at non-objects", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    Object.assign(a, { cause: b });
    expect([...causeChain(a)]).toEqual([a, b]);
    expect([...causeChain(new Error("x", { cause: "text" }))]).toHaveLength(1);
    expect([...causeChain(undefined)]).toEqual([]);
  });
});
