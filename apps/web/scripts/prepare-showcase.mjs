/**
 * Prepare the sample images used on public pages.
 *
 * Source: public/images/showcase/showcase-N.jpg (900×1200 portrait or
 * 1200×900 landscape). For each image it
 * - writes a WebP whose short side is 540px to public/images/showcase/web/
 *   (thumbnails and cards),
 * - writes a 900px-wide WebP to public/images/showcase/lg/ (the big tilted
 *   screen),
 * - prints the ambient glow colours, computed with the same sampler the app
 *   uses at runtime, so src/components/landing/showcase.ts can light the
 *   first paint without waiting for the browser to sample.
 *
 * Usage (Node 22+, type stripping); pass numbers to process only those:
 *   SHARP_PATH=/path/to/sharp node --experimental-strip-types scripts/prepare-showcase.mjs [3 8 ...]
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sharp = (await import(process.env.SHARP_PATH ?? "sharp")).default;
const { pickAmbient, toTriplet } = await import(path.join(root, "src/lib/ambient-color.ts"));

const src = path.join(root, "public/images/showcase");
const web = path.join(src, "web");
const lg = path.join(src, "lg");
await mkdir(web, { recursive: true });
await mkdir(lg, { recursive: true });

const only = process.argv.slice(2).map(Number).filter(Boolean);
const numbers = only.length ? only : Array.from({ length: 12 }, (_, i) => i + 1);

for (const i of numbers) {
  const name = `showcase-${i}`;
  const input = path.join(src, `${name}.jpg`);
  const { width = 0, height = 0 } = await sharp(input).metadata();
  const short = width >= height ? { height: 540 } : { width: 540 };
  await sharp(input).resize(short).webp({ quality: 78 }).toFile(path.join(web, `${name}.webp`));
  await sharp(input).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(lg, `${name}.webp`));
  const { data } = await sharp(input).resize(24, 24, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colors = pickAmbient(new Uint8ClampedArray(data));
  console.log(`${name}: amb "${toTriplet(colors.amb)}", amb2 "${toTriplet(colors.amb2)}"`);
}
