/**
 * Regenerates the public brand assets from the GGUU mark:
 *   public/favicon.svg, public/logo.svg, public/apple-touch-icon.png,
 *   public/og-image.png (1200×630, the 氛围屏 room as a share card).
 *
 * The mark geometry mirrors src/components/brand/brand-mark.tsx; keep both in
 * sync. Static files cannot read CSS variables, so the orb uses the default
 * room light (--amb 72 214 204, --amb-2 70 120 255) as literal colours.
 *
 * Usage (from apps/web):
 *   OG_FONT_DIR=/path/to/ttf node scripts/generate-brand-assets.mjs
 * OG_FONT_DIR must hold (TTF/OTF; satori cannot read WOFF2):
 *   - display.ttf   Smiley Sans Oblique (OFL; the source of "GGUU Display",
 *                   e.g. scripts/font-src/SmileySans-Oblique.ttf.woff2 decompressed)
 *   - geist-700.ttf Geist Bold (Google Fonts)
 *   - noto-sc-500.ttf Noto Sans SC Medium (Google Fonts; may be subset with
 *                   `&text=` to the Chinese strings below)
 * SHARP_PATH can point at a sharp install when it is not resolvable here.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

// Room tokens (src/app/globals.css).
const GROUND = "#0a0f1e";
const GROUND_DEEP = "#060912";
const FG = "#eef2fa";
const FG_SOFT = "#b0b9ce";
const AMB = "rgb(72 214 204)";
const AMB_2 = "rgb(70 120 255)";

// The share card shows the landing page's first sample (showcase.ts, id 5)
// in its own light.
const OG_SAMPLE = path.join(publicDir, "images/showcase/lg/showcase-5.webp");
const OG_SAMPLE_AMB = [188, 88, 78];

function markSvg({ size = 32, title = "GGUU AI IMAGE", fullBleed = false } = {}) {
  const radius = fullBleed ? 0 : 8.5;
  const edge = fullBleed
    ? ""
    : `<rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="none" stroke="rgb(255 255 255 / 0.16)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" role="img" aria-label="${title}"><title>${title}</title><defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d2744"/><stop offset="1" stop-color="#090e1c"/></linearGradient><radialGradient id="o" cx="0.38" cy="0.36" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="${AMB}"/><stop offset="1" stop-color="${AMB_2}"/></radialGradient><radialGradient id="g"><stop offset="0" stop-color="${AMB}" stop-opacity="0.55"/><stop offset="1" stop-color="${AMB}" stop-opacity="0"/></radialGradient></defs><rect width="32" height="32" rx="${radius}" fill="url(#t)"/>${edge}<circle cx="16" cy="14" r="10" fill="url(#g)"/><line x1="7" y1="21" x2="25" y2="21" stroke="rgb(255 255 255 / 0.2)" stroke-width="0.8"/><ellipse cx="16" cy="24" rx="4.4" ry="1.4" fill="${AMB}" opacity="0.4"/><circle cx="16" cy="14" r="5.2" fill="url(#o)"/></svg>\n`;
}

function loadSharp() {
  return require(process.env.SHARP_PATH ?? "sharp");
}

async function writeIcons() {
  await writeFile(path.join(publicDir, "favicon.svg"), markSvg());
  await writeFile(path.join(publicDir, "logo.svg"), markSvg({ size: 512 }));
  const sharp = loadSharp();
  // Apple applies its own corner mask, so the touch icon is full-bleed.
  await sharp(Buffer.from(markSvg({ size: 180, fullBleed: true })))
    .png()
    .toFile(path.join(publicDir, "apple-touch-icon.png"));
  console.log("[brand-assets] favicon.svg, logo.svg, apple-touch-icon.png written");
}

/* ---------- OG image (satori via next/og, composited with sharp) ---------- */

function h(type, props, ...children) {
  return { type, props: { ...props, children: children.length <= 1 ? children[0] : children } };
}

const rgb = ([r, g, b], a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;

/** Headline accent: the room colour mixed 42% into white, as on the page. */
function accent([r, g, b]) {
  const mix = (c) => Math.round(c * 0.42 + 255 * 0.58);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function ogTree({ room, sample }) {
  return h(
    "div",
    {
      style: {
        width: 1200,
        height: 630,
        display: "flex",
        position: "relative",
        background: GROUND,
        fontFamily: "NotoSC",
        overflow: "hidden",
      },
    },
    // The room (light field, vignette, floor, reflection), pre-composed.
    h("img", { src: room, width: 1200, height: 630, style: { position: "absolute", left: 0, top: 0 } }),
    // The screen: the sample, lit.
    h(
      "div",
      {
        style: {
          position: "absolute",
          left: 682,
          top: 64,
          width: 440,
          height: 450,
          display: "flex",
          overflow: "hidden",
          borderRadius: 22,
          border: "1px solid rgba(255,255,255,0.16)",
          boxShadow: `0 60px 120px -40px rgba(0,0,0,0.9), 0 0 120px -20px ${rgb(OG_SAMPLE_AMB, 0.6)}`,
        },
      },
      h("img", { src: sample, width: 440, height: 450, style: { objectFit: "cover" } }),
      h("div", {
        style: {
          position: "absolute",
          inset: 0,
          display: "flex",
          backgroundImage: "linear-gradient(115deg, rgba(255,255,255,0.10), transparent 32%)",
        },
      }),
    ),
    // Copy.
    h(
      "div",
      {
        style: {
          position: "absolute",
          left: 72,
          top: 64,
          display: "flex",
          flexDirection: "column",
        },
      },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 14 } },
        h("img", {
          src: `data:image/svg+xml;base64,${Buffer.from(markSvg({ size: 44 })).toString("base64")}`,
          width: 44,
          height: 44,
        }),
        h("div", { style: { fontFamily: "Geist", fontSize: 30, fontWeight: 700, color: FG, letterSpacing: -0.5 } }, "GGUU"),
        h(
          "div",
          {
            style: {
              display: "flex",
              fontFamily: "Geist",
              fontSize: 14,
              fontWeight: 700,
              color: FG_SOFT,
              letterSpacing: 2,
              padding: "3px 8px",
              border: "1px solid rgba(255,255,255,0.28)",
              borderRadius: 6,
            },
          },
          "AI IMAGE",
        ),
      ),
      h(
        "div",
        {
          style: {
            marginTop: 64,
            display: "flex",
            flexDirection: "column",
            fontFamily: "Display",
            fontSize: 104,
            lineHeight: 1.02,
            color: FG,
          },
        },
        h("div", {}, "想到什么，"),
        h(
          "div",
          { style: { display: "flex" } },
          "就",
          h("span", { style: { color: accent(OG_SAMPLE_AMB) } }, "生成"),
          "什么",
        ),
      ),
      h(
        "div",
        { style: { marginTop: 34, fontSize: 26, fontWeight: 500, color: FG_SOFT, lineHeight: 1.6 } },
        "主站账号直接登录，按次从主站余额扣费",
      ),
    ),
  );
}

/**
 * The card's background, built with sharp because satori has no blur,
 * masks or reliable radial gradients: the sample huge and defocused at
 * right (feathered into the ground), the vignette, the floor band, and the
 * screen's reflection on the floor.
 */
async function composeRoom(sharp) {
  const [r, g, b] = OG_SAMPLE_AMB;
  const fieldW = 1100;
  const fieldH = 760;
  const feather = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fieldW}" height="${fieldH}"><defs><linearGradient id="f" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.35" stop-color="#fff" stop-opacity="1"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#f)"/></svg>`,
  );
  const field = await sharp(OG_SAMPLE)
    .resize(fieldW, fieldH, { fit: "cover" })
    .modulate({ saturation: 1.7 })
    .blur(70)
    .ensureAlpha(0.7)
    .composite([{ input: feather, blend: "dest-in" }])
    .png()
    .toBuffer()
    // sharp only composites inputs that fit the canvas: keep the visible part.
    .then((buf) => sharp(buf).extract({ left: 0, top: 80, width: 1200 - 420, height: 630 }).png().toBuffer());

  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs>` +
      `<radialGradient id="v" cx="0.72" cy="0.35" r="0.9"><stop offset="0" stop-color="${GROUND_DEEP}" stop-opacity="0"/><stop offset="0.6" stop-color="${GROUND_DEEP}" stop-opacity="0.55"/><stop offset="1" stop-color="${GROUND_DEEP}" stop-opacity="1"/></radialGradient>` +
      `<linearGradient id="fl" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="rgb(${r},${g},${b})" stop-opacity="0.12"/><stop offset="0.7" stop-color="rgb(${r},${g},${b})" stop-opacity="0"/></linearGradient>` +
      `</defs><rect width="1200" height="630" fill="url(#v)"/><rect y="526" width="1200" height="104" fill="url(#fl)"/><rect y="526" width="1200" height="1" fill="#ffffff" fill-opacity="0.06"/></svg>`,
  );

  // Mirror of the screen's lower part, fading out down the floor.
  const reflW = 440;
  const reflH = 96;
  const fade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${reflW}" height="${reflH}"><defs><linearGradient id="r" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.24"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" rx="0" fill="url(#r)"/></svg>`,
  );
  const screen = await sharp(OG_SAMPLE).resize(reflW, 450, { fit: "cover", position: "attention" }).toBuffer();
  const reflection = await sharp(screen)
    .extract({ left: 0, top: 450 - reflH, width: reflW, height: reflH })
    .flip()
    .blur(1.5)
    .ensureAlpha()
    .composite([{ input: fade, blend: "dest-in" }])
    .png()
    .toBuffer();

  return sharp({ create: { width: 1200, height: 630, channels: 4, background: GROUND } })
    .composite([
      { input: field, left: 420, top: 0 },
      { input: overlay, left: 0, top: 0 },
      { input: reflection, left: 682, top: 524 },
    ])
    .png()
    .toBuffer();
}

async function writeOg() {
  const fontDir = process.env.OG_FONT_DIR;
  if (!fontDir) {
    console.warn("[brand-assets] OG_FONT_DIR not set; skipping og-image.png");
    return;
  }
  const sharp = loadSharp();
  const dataUri = (buf, type) => `data:${type};base64,${buf.toString("base64")}`;
  const room = await composeRoom(sharp);
  const sample = await sharp(OG_SAMPLE).resize(880, 900, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();

  const font = (name) => readFile(path.join(fontDir, name));
  const { ImageResponse } = require("next/dist/compiled/@vercel/og/index.node.js");
  const res = new ImageResponse(
    ogTree({ room: dataUri(room, "image/png"), sample: dataUri(sample, "image/jpeg") }),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Display", data: await font("display.ttf"), weight: 400, style: "normal" },
        { name: "Geist", data: await font("geist-700.ttf"), weight: 700, style: "normal" },
        { name: "NotoSC", data: await font("noto-sc-500.ttf"), weight: 500, style: "normal" },
      ],
    },
  );
  const png = Buffer.from(await res.arrayBuffer());
  await writeFile(path.join(publicDir, "og-image.png"), png);
  console.log(`[brand-assets] og-image.png written (${png.length} bytes)`);
}

await writeIcons();
await writeOg();
