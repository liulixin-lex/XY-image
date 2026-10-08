/**
 * Ambient colour sampling for the 夜色光场 world.
 *
 * The page is lit by the image on show: we read a tiny thumbnail of it and
 * pick two glow colours (`--amb`, `--amb-2`, bare "R G B" triplets). The
 * colours are normalised so they always glow on the night ground, even when
 * the source image is dull or dark.
 *
 * Cross-origin images need CORS (Supabase storage sends it); when the
 * canvas is tainted or the image fails, callers keep the current light.
 */

export type Rgb = readonly [number, number, number];
export type AmbientColors = { amb: Rgb; amb2: Rgb };

/** Default light: teal over blue (also the static brand colours). */
export const DEFAULT_AMBIENT: AmbientColors = {
  amb: [72, 214, 204],
  amb2: [70, 120, 255],
};

/** Used when an image has almost no colour (greyscale, near-black). */
const NEUTRAL_AMBIENT: AmbientColors = {
  amb: [150, 172, 214],
  amb2: [92, 112, 176],
};

const SAMPLE_SIZE = 24;
const HUE_BINS = 18;
/**
 * Amber/yellow band (degrees). The product has no amber or yellow fields
 * (user decision, 2026-10-07): these hues are down-weighted when picking the
 * light, and a light that still lands here is turned toward warm coral.
 */
const AMBER_FROM = 20;
const AMBER_TO = 72;
const AMBER_WEIGHT = 0.3;
const WARM_FALLBACK_HUE = 10;

export function toTriplet([r, g, b]: Rgb) {
  return `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const inAmber = (h: number) => h >= AMBER_FROM && h <= AMBER_TO;

/** Steer amber/yellow lights to warm coral (see AMBER_FROM). */
function avoidAmber(h: number) {
  return inAmber(h) ? WARM_FALLBACK_HUE : h;
}

/** Make a colour glow on the night ground: lively but never neon or murky. */
function asGlow(h: number, s: number, l: number): Rgb {
  return hslToRgb(avoidAmber(h), clamp(s, 0.45, 0.82), clamp(l, 0.52, 0.64));
}

/** A second light 34° from the first, turning away from the amber band. */
function neighbourHue(h: number) {
  const base = avoidAmber(h);
  return inAmber(base + 34) ? base - 34 : base + 34;
}

function hueDistance(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Pure part of the sampler: RGBA pixels in, glow colours out.
 * Exported for tests.
 */
export function pickAmbient(pixels: Uint8ClampedArray | number[]): AmbientColors {
  const weight = new Array<number>(HUE_BINS).fill(0);
  const sumR = new Array<number>(HUE_BINS).fill(0);
  const sumG = new Array<number>(HUE_BINS).fill(0);
  const sumB = new Array<number>(HUE_BINS).fill(0);
  let total = 0;
  let count = 0;

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const a = pixels[i + 3]!;
    if (a < 128) continue;
    count += 1;
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const chroma = max - min;
    // Ignore near-black and near-grey pixels: they carry no light colour.
    if (max < 0.14 || chroma < 0.05) continue;
    const [h] = rgbToHsl(r, g, b);
    const bin = Math.floor(h / (360 / HUE_BINS)) % HUE_BINS;
    // Chroma-weighted, with a mild preference for brighter pixels.
    const w = chroma * (0.6 + 0.4 * max) * (inAmber(h) ? AMBER_WEIGHT : 1);
    weight[bin]! += w;
    sumR[bin]! += r * w;
    sumG[bin]! += g * w;
    sumB[bin]! += b * w;
    total += w;
  }

  // Almost no pixel carries colour: treat as a neutral image.
  if (count === 0 || total < count * 0.012) return NEUTRAL_AMBIENT;

  const order = weight
    .map((w, bin) => ({ w, bin }))
    .filter((entry) => entry.w > 0)
    .sort((a, b) => b.w - a.w);

  const average = (bin: number): [number, number, number] => {
    const w = weight[bin]!;
    return rgbToHsl(sumR[bin]! / w, sumG[bin]! / w, sumB[bin]! / w);
  };

  const first = order[0]!;
  const [h1, s1, l1] = average(first.bin);
  const amb = asGlow(h1, s1, l1);

  // Second light: the next strong hue at least 40° away, else a neighbour.
  const second = order.find(
    (entry) =>
      entry.bin !== first.bin &&
      entry.w > first.w * 0.18 &&
      hueDistance(average(entry.bin)[0], h1) >= 40,
  );
  const amb2 = second
    ? (() => {
        const [h2, s2, l2] = average(second.bin);
        const hue = inAmber(h2) ? neighbourHue(h1) : h2;
        return hslToRgb(hue, clamp(s2, 0.45, 0.8), clamp(l2 - 0.06, 0.42, 0.56));
      })()
    : hslToRgb(neighbourHue(h1), clamp(s1, 0.5, 0.8), 0.48);

  return { amb, amb2 };
}

const cache = new Map<string, AmbientColors>();

/**
 * Sample glow colours from an image URL. Resolves to null when the image
 * cannot be read (network error, tainted canvas); callers keep the
 * current light in that case.
 */
export async function sampleAmbient(src: string): Promise<AmbientColors | null> {
  const cached = cache.get(src);
  if (cached) return cached;
  if (typeof window === "undefined") return null;
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const colors = pickAmbient(data);
    cache.set(src, colors);
    if (cache.size > 80) cache.delete(cache.keys().next().value as string);
    return colors;
  } catch (error) {
    console.info("[ambient] could not sample image colours; keeping current light", error);
    return null;
  }
}
