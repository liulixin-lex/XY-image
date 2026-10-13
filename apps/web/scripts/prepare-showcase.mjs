/**
 * Prepare the sample images used on public pages (第 62 条: all generated on
 * this site with GPT Image 2.5 Sunburst at 4K, quality high).
 *
 * Input: a JSON list `[{ "id": "tulip-dune", "file": "/abs/path/original.png" }, …]`
 * (the 4K originals stay outside the repo). For each entry it
 * - writes a master JPEG (long edge 1600px) to assets/showcase/<id>.jpg — kept
 *   in the repo so the WebPs can be rebuilt, but outside public/, so it is
 *   never shipped;
 * - writes public/images/showcase/web/<id>.webp, 600px on the short side
 *   (cards, thumbnails);
 * - writes public/images/showcase/lg/<id>.webp, 1200px wide (the big slanted
 *   poster, retina cards);
 * - prints the ambient glow colours, computed with the same sampler the app
 *   uses at runtime, so src/components/landing/showcase.ts can light the
 *   first paint without waiting for the browser to sample.
 *
 * Usage (Node 22+, type stripping):
 *   SHARP_PATH=/path/to/sharp/lib/index.js node --experimental-strip-types scripts/prepare-showcase.mjs list.json
 * With no list, it rebuilds the WebPs from every master in assets/showcase/.
 */
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sharp = (await import(process.env.SHARP_PATH ?? "sharp")).default;
const { pickAmbient, toTriplet } = await import(path.join(root, "src/lib/ambient-color.ts"));

const masters = path.join(root, "assets/showcase");
const pub = path.join(root, "public/images/showcase");
const web = path.join(pub, "web");
const lg = path.join(pub, "lg");
await mkdir(masters, { recursive: true });
await mkdir(web, { recursive: true });
await mkdir(lg, { recursive: true });

const listPath = process.argv[2];
const entries = listPath
  ? JSON.parse(await readFile(listPath, "utf8"))
  : (await readdir(masters))
      .filter((name) => name.endsWith(".jpg"))
      .map((name) => ({ id: name.replace(/\.jpg$/, ""), file: null }));

for (const { id, file } of entries) {
  const master = path.join(masters, `${id}.jpg`);
  if (file) {
    await sharp(file)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true })
      .toFile(master);
  }
  const { width = 0, height = 0 } = await sharp(master).metadata();
  const short = width >= height ? { height: 600 } : { width: 600 };
  await sharp(master).resize(short).webp({ quality: 80 }).toFile(path.join(web, `${id}.webp`));
  await sharp(master)
    .resize({ width: 1200, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(lg, `${id}.webp`));
  const { data } = await sharp(master)
    .resize(24, 24, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colors = pickAmbient(new Uint8ClampedArray(data));
  const ratio = width >= height ? "4:3" : "3:4";
  console.log(`${id}: ${width}x${height} ${ratio} amb "${toTriplet(colors.amb)}", amb2 "${toTriplet(colors.amb2)}"`);
}
