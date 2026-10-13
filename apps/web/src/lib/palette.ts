/**
 * 从标志取色 (第 58 条): the main colours of a logo, for the brand kit.
 *
 * Pixels are counted in 4-bit-per-channel buckets (4096 of them), each bucket
 * keeps the average of its pixels, and the most common buckets are taken
 * while they differ enough from the ones already picked. Transparent pixels
 * and near-white ones (the paper most logos sit on) are skipped; black stays,
 * since logo type is often black. No dependencies; runs on a 96 px copy.
 */

const SIDE = 96;
/** Distance in RGB below which two colours count as the same one. */
const MIN_DISTANCE = 56;

export function toHex([r, g, b]: readonly [number, number, number]) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function distance(a: readonly number[], b: readonly number[]) {
  // Weighted for the eye (green counts most).
  const dr = (a[0] ?? 0) - (b[0] ?? 0);
  const dg = (a[1] ?? 0) - (b[1] ?? 0);
  const db = (a[2] ?? 0) - (b[2] ?? 0);
  return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db) * 1.6;
}

function nearWhite(r: number, g: number, b: number) {
  return Math.min(r, g, b) > 236 && Math.max(r, g, b) - Math.min(r, g, b) < 18;
}

/** RGBA pixels (as from getImageData) → up to `count` hex colours, most used first. */
export function extractPalette(pixels: ArrayLike<number>, count = 5): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i] as number;
    const g = pixels[i + 1] as number;
    const b = pixels[i + 2] as number;
    const a = pixels[i + 3] as number;
    if (a < 128 || nearWhite(r, g, b)) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .sort((x, y) => y.n - x.n)
    .map((bucket) => [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n] as [number, number, number]);
  const picked: Array<[number, number, number]> = [];
  for (const colour of ranked) {
    if (picked.length >= count) break;
    if (picked.every((p) => distance(p, colour) >= MIN_DISTANCE)) picked.push(colour);
  }
  return picked.map(toHex);
}

/**
 * Loads an image (CORS) and returns its palette. Throws when the image will
 * not load or the canvas is tainted (a host without CORS headers).
 */
export async function paletteFromImage(url: string, count = 5): Promise<string[]> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("image did not load"));
    image.src = url;
  });
  const scale = Math.min(1, SIDE / Math.max(image.naturalWidth, image.naturalHeight, 1));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");
  context.drawImage(image, 0, 0, width, height);
  return extractPalette(context.getImageData(0, 0, width, height).data, count);
}
