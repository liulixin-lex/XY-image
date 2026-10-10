import { describe, expect, it } from "vitest";

import { pickAmbient, toTriplet } from "../src/lib/ambient-color";

function solid(r: number, g: number, b: number, count = 64) {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(r, g, b, 255);
  return out;
}

function hueOf([r, g, b]: readonly [number, number, number]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe("pickAmbient", () => {
  it("lights the page with the image's dominant hue", () => {
    const { amb } = pickAmbient(solid(200, 40, 40));
    expect(hueOf(amb)).toBeLessThan(15);
  });

  it("brightens a dark image so the glow stays visible", () => {
    const { amb } = pickAmbient(solid(60, 10, 10));
    expect(Math.max(...amb)).toBeGreaterThan(180);
  });

  it("picks a second light from a distinct hue", () => {
    const pixels = [...solid(30, 180, 200, 70), ...solid(220, 60, 120, 30)];
    const { amb, amb2 } = pickAmbient(pixels);
    expect(Math.abs(hueOf(amb) - hueOf(amb2))).toBeGreaterThan(40);
  });

  it("never lights the page amber or yellow", () => {
    const yellowOnly = pickAmbient(solid(230, 200, 40));
    for (const light of [yellowOnly.amb, yellowOnly.amb2]) {
      const hue = hueOf(light);
      expect(hue < 20 || hue > 72).toBe(true);
    }
    // A yellow beanie with a blue mug: the blue wins.
    const mixed = pickAmbient([...solid(230, 200, 40, 60), ...solid(40, 90, 210, 40)]);
    expect(hueOf(mixed.amb)).toBeGreaterThan(190);
    expect(hueOf(mixed.amb)).toBeLessThan(240);
  });

  it("falls back to a neutral rose-grey light for greyscale images", () => {
    const { amb } = pickAmbient(solid(128, 128, 128));
    expect(toTriplet(amb)).toBe("190 160 172");
  });

  it("ignores transparent pixels", () => {
    const pixels = solid(200, 40, 40).map((v, i) => (i % 4 === 3 ? 0 : v));
    expect(toTriplet(pickAmbient(pixels).amb)).toBe("190 160 172");
  });
});
