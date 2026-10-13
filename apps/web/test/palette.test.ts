import { describe, expect, it } from "vitest";

import { extractPalette, toHex } from "../src/lib/palette";

/** n pixels of one RGBA colour. */
function fill(n: number, rgba: [number, number, number, number]) {
  return Array.from({ length: n }, () => rgba).flat();
}

describe("从标志取色 (第 58 条)", () => {
  it("finds the logo's colours, most used first, without the white paper", () => {
    const pixels = [
      ...fill(500, [255, 255, 255, 255]), // background
      ...fill(300, [212, 42, 41, 255]), // 朱红
      ...fill(120, [21, 23, 27, 255]), // 炭黑 text
      ...fill(60, [214, 44, 40, 255]), // the same red, slightly off
      ...fill(40, [79, 116, 200, 255]), // a blue accent
      ...fill(200, [0, 200, 0, 0]), // transparent
    ];
    expect(extractPalette(pixels)).toEqual(["#D42A29", "#15171B", "#4F74C8"]);
  });

  it("stops at the asked count and handles an empty image", () => {
    const pixels = [
      ...fill(10, [200, 30, 30, 255]),
      ...fill(9, [30, 200, 30, 255]),
      ...fill(8, [30, 30, 200, 255]),
      ...fill(7, [220, 200, 40, 255]),
    ];
    expect(extractPalette(pixels, 2)).toHaveLength(2);
    expect(extractPalette([])).toEqual([]);
    expect(toHex([0, 128.4, 255])).toBe("#0080FF");
  });
});
