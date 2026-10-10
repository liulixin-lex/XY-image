/**
 * Regenerates the public brand assets in the F2 soft-poster world:
 *   public/favicon.svg, public/logo.svg   the coral slanted tile
 *   public/apple-touch-icon.png           the tile on the pale wall (180×180)
 *   public/og-image.png                   1200×630 share card: the landing's
 *                                          poster (headline, slanted picture
 *                                          standing on the horizon, sticker)
 *
 * The mark geometry mirrors src/components/brand/brand-mark.tsx and the room
 * colours mirror src/app/globals.css (light theme); keep them in sync. Static
 * files cannot read CSS variables, so the values are literal here.
 *
 * Usage (from apps/web):
 *   OG_FONT_DIR=/path/to/ttf node scripts/generate-brand-assets.mjs
 * OG_FONT_DIR must hold (TTF/OTF; satori cannot read WOFF2):
 *   - display.ttf     优设标题黑 = "GGUU Display" (scripts/font-src/
 *                     YouSheBiaoTiHei.woff2 decompressed, e.g. fontTools:
 *                     `f = TTFont(src); f.flavor = None; f.save(dst)`)
 *   - geist-600.ttf   Geist SemiBold (Google Fonts)
 *   - noto-sc-500.ttf Noto Sans SC Medium (Google Fonts; may be subset with
 *                     `&text=` to OG_SUBTITLE below)
 * Without OG_FONT_DIR only the icons are written.
 * SHARP_PATH can point at a sharp install when it is not resolvable here.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

// Room tokens, light theme (src/app/globals.css).
const WALL = "#f5f2f3";
const WALL_2 = "#ede9eb";
const FLOOR = "#e6e1e4";
const FLOOR_2 = "#dbd5d9";
const FG = "#24212b";
const FG_SOFT = "#5c5766";
const CORAL = "#e5533d";
const CORAL_GLOW = "rgba(229, 83, 61, 0.42)";
const SHADOW = "84, 52, 60";

// The share card shows showcase-8 (Unsplash License, see
// src/components/landing/showcase.ts) in its own light: amb / amb2 as
// computed by scripts/prepare-showcase.mjs.
const OG_SAMPLE = path.join(publicDir, "images/showcase/lg/showcase-8.webp");
const OG_SAMPLE_AMB = [227, 116, 100];
const OG_SAMPLE_AMB_2 = [207, 38, 112];
const OG_SAMPLE_FOCUS = "north";
// Same words as the landing hero (components/landing/hero.tsx).
const OG_SUBTITLE = "主站账号直接登录。每张图都带请求 ID，在主站的用量记录里查得到。";

/** The coral tile on the poster slant (brand-mark.tsx). */
function markSvg({ size = 32, title = "GGUU AI IMAGE" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" role="img" aria-label="${title}"><title>${title}</title><rect x="6" y="5" width="22" height="22" rx="5.5" transform="translate(3.5 0) skewX(-14)" fill="${CORAL}"/></svg>\n`;
}

/** Touch icon: the tile on the wall with its coral pool. Apple masks the corners. */
function touchIconSvg(size = 180) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"><defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${WALL}"/><stop offset="0.62" stop-color="${WALL_2}"/><stop offset="1" stop-color="${FLOOR}"/></linearGradient><filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter></defs><rect width="32" height="32" fill="url(#w)"/><ellipse cx="16.5" cy="25.2" rx="8" ry="1.6" fill="${CORAL}" opacity="0.35" filter="url(#s)"/><g transform="translate(16 15.6) scale(0.72) translate(-16 -16)"><rect x="6" y="5" width="22" height="22" rx="5.5" transform="translate(3.5 0) skewX(-14)" fill="${CORAL}"/></g></svg>`;
}

function loadSharp() {
  return require(process.env.SHARP_PATH ?? "sharp");
}

async function writeIcons(sharp) {
  await writeFile(path.join(publicDir, "favicon.svg"), markSvg());
  await writeFile(path.join(publicDir, "logo.svg"), markSvg({ size: 512 }));
  await sharp(Buffer.from(touchIconSvg(180)))
    .png()
    .toFile(path.join(publicDir, "apple-touch-icon.png"));
  console.log("[brand-assets] favicon.svg, logo.svg, apple-touch-icon.png written");
}

/* ---------- OG image: room and picture with sharp, words with satori ---------- */

const W = 1200;
const H = 630;
const HORIZON = 486;
// The picture: a slanted frame (-8°, 14px corners) standing on the horizon.
const SLANT = Math.tan((8 * Math.PI) / 180);
const PIC = { w: 318, h: 410 };
PIC.shift = Math.round(PIC.h * SLANT);
PIC.boxW = PIC.w + PIC.shift;
PIC.left = 764;
PIC.top = HORIZON - PIC.h - 4;

const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`;

/** A slanted, softly rounded parallelogram as an SVG mask of the given box. */
function slantMask(w, h, { radius = 14, fill = "#fff" } = {}) {
  const shift = Math.round(h * SLANT);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w + shift}" height="${h}"><rect x="${shift}" y="0" width="${w}" height="${h}" rx="${radius}" transform="skewX(-8)" fill="${fill}"/></svg>`,
  );
}

async function slantedPicture(sharp) {
  // Like `sk-frame`: the picture stays upright, only the frame leans.
  const picture = await sharp(OG_SAMPLE)
    .resize(PIC.boxW, PIC.h, { fit: "cover", position: OG_SAMPLE_FOCUS })
    .ensureAlpha()
    .composite([{ input: slantMask(PIC.w, PIC.h), blend: "dest-in" }])
    .png()
    .toBuffer();
  // Its reflection on the floor: the lower part, flipped, fading out.
  const reflH = 92;
  const fade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PIC.boxW}" height="${reflH}"><defs><linearGradient id="r" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#r)"/></svg>`,
  );
  const reflection = await sharp(picture)
    .extract({ left: 0, top: PIC.h - reflH, width: PIC.boxW, height: reflH })
    .flip()
    .blur(2)
    .composite([{ input: fade, blend: "dest-in" }])
    .png()
    .toBuffer();
  return { picture, reflection, reflH };
}

/**
 * The room behind the words: wall fading to a floor at the horizon, the
 * sample's colour hazing the wall, a translucent slanted block of its second
 * colour behind the picture, the picture with its contact shadow and its
 * reflection.
 */
async function composeRoom(sharp) {
  const amb = OG_SAMPLE_AMB;
  const amb2 = OG_SAMPLE_AMB_2;
  const room = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>` +
      `<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${WALL}"/><stop offset="1" stop-color="${WALL_2}"/></linearGradient>` +
      `<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${FLOOR}"/><stop offset="1" stop-color="${FLOOR_2}"/></linearGradient>` +
      `<radialGradient id="haze" cx="0.74" cy="0.42" r="0.62"><stop offset="0" stop-color="${rgba(amb, 0.34)}"/><stop offset="0.55" stop-color="${rgba(amb, 0.12)}"/><stop offset="1" stop-color="${rgba(amb, 0)}"/></radialGradient>` +
      `<radialGradient id="pool" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${rgba(amb, 0.22)}"/><stop offset="1" stop-color="${rgba(amb, 0)}"/></radialGradient>` +
      `</defs>` +
      `<rect width="${W}" height="${HORIZON}" fill="url(#wall)"/>` +
      `<rect y="${HORIZON}" width="${W}" height="${H - HORIZON}" fill="url(#floor)"/>` +
      `<rect width="${W}" height="${H}" fill="url(#haze)"/>` +
      `<rect y="${HORIZON}" width="${W}" height="1" fill="rgba(${SHADOW}, 0.12)"/>` +
      `<ellipse cx="${PIC.left + PIC.boxW / 2}" cy="${HORIZON + 46}" rx="300" ry="54" fill="url(#pool)"/>` +
      `</svg>`,
  );
  const blockW = 300;
  const blockH = 372;
  const block = await sharp(slantMask(blockW, blockH, { radius: 16, fill: rgba(amb2, 0.15) }))
    .png()
    .toBuffer();
  const contact = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PIC.boxW + 80}" height="60"><ellipse cx="${(PIC.boxW + 80) / 2}" cy="30" rx="${PIC.boxW / 2}" ry="9" fill="rgba(${SHADOW}, 0.32)"/></svg>`,
    ),
  )
    .blur(7)
    .png()
    .toBuffer();
  const { picture, reflection } = await slantedPicture(sharp);
  return sharp(room)
    .composite([
      { input: block, left: PIC.left + 62, top: PIC.top - 26 },
      { input: contact, left: PIC.left - 40, top: HORIZON - 30 },
      { input: reflection, left: PIC.left, top: HORIZON + 2 },
      { input: picture, left: PIC.left, top: PIC.top },
    ])
    .png()
    .toBuffer();
}

function h(type, props, ...children) {
  return { type, props: { ...props, children: children.length <= 1 ? children[0] : children } };
}

function ogTree({ room }) {
  const mark = `data:image/svg+xml;base64,${Buffer.from(markSvg({ size: 40 })).toString("base64")}`;
  return h(
    "div",
    {
      style: {
        width: W,
        height: H,
        display: "flex",
        position: "relative",
        background: WALL,
        fontFamily: "NotoSC",
        overflow: "hidden",
      },
    },
    h("img", { src: room, width: W, height: H, style: { position: "absolute", left: 0, top: 0 } }),
    // Lockup: tile, GGUU, slanted AI IMAGE tag.
    h(
      "div",
      { style: { position: "absolute", left: 72, top: 56, display: "flex", alignItems: "center", gap: 10 } },
      h("img", { src: mark, width: 40, height: 40 }),
      h("div", { style: { fontFamily: "Display", fontSize: 34, color: FG, letterSpacing: 0.6 } }, "GGUU"),
      h(
        "div",
        {
          style: {
            display: "flex",
            marginLeft: 4,
            padding: "6px 9px",
            borderRadius: 6,
            background: "rgba(36, 33, 43, 0.06)",
            transform: "skewX(-10deg)",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              transform: "skewX(10deg)",
              fontFamily: "Geist",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 2.2,
              color: FG_SOFT,
            },
          },
          "AI IMAGE",
        ),
      ),
    ),
    // Headline and subtitle, as on the landing page.
    h(
      "div",
      { style: { position: "absolute", left: 66, top: 116, display: "flex", flexDirection: "column" } },
      h("div", { style: { fontFamily: "Display", fontSize: 160, lineHeight: 1, color: FG, letterSpacing: -1.5 } }, "一句话"),
      h(
        "div",
        { style: { display: "flex", marginTop: 18, fontFamily: "Display", fontSize: 72, lineHeight: 1, color: FG } },
        "生成你",
        h("span", { style: { color: CORAL } }, "想要的图"),
      ),
      h(
        "div",
        {
          style: {
            marginTop: 28,
            marginLeft: 4,
            display: "flex",
            flexDirection: "column",
            fontSize: 22,
            lineHeight: 1.65,
            color: FG_SOFT,
          },
        },
        // One sentence per line, so no word is split.
        ...OG_SUBTITLE.split(/(?<=。)/).map((line) => h("div", {}, line)),
      ),
    ),
    // The 示例作品 sticker, slapped on the picture's corner.
    h(
      "div",
      {
        style: {
          position: "absolute",
          left: PIC.left + PIC.shift - 26,
          top: PIC.top - 16,
          display: "flex",
          padding: "9px 15px",
          borderRadius: 10,
          background: CORAL,
          color: "#ffffff",
          fontFamily: "Display",
          fontSize: 19,
          lineHeight: 1,
          transform: "rotate(-6deg)",
          boxShadow: `0 14px 30px -12px ${CORAL_GLOW}`,
        },
      },
      "示例作品",
    ),
  );
}

async function writeOg(sharp) {
  const fontDir = process.env.OG_FONT_DIR;
  if (!fontDir) {
    console.warn("[brand-assets] OG_FONT_DIR not set; skipping og-image.png");
    return;
  }
  const room = await composeRoom(sharp);
  const font = (name) => readFile(path.join(fontDir, name));
  const { ImageResponse } = require("next/dist/compiled/@vercel/og/index.node.js");
  const res = new ImageResponse(ogTree({ room: `data:image/png;base64,${room.toString("base64")}` }), {
    width: W,
    height: H,
    fonts: [
      { name: "Display", data: await font("display.ttf"), weight: 400, style: "normal" },
      { name: "Geist", data: await font("geist-600.ttf"), weight: 600, style: "normal" },
      { name: "NotoSC", data: await font("noto-sc-500.ttf"), weight: 500, style: "normal" },
    ],
  });
  const png = await sharp(Buffer.from(await res.arrayBuffer()))
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  await writeFile(path.join(publicDir, "og-image.png"), png);
  console.log(`[brand-assets] og-image.png written (${png.length} bytes)`);
}

const sharp = loadSharp();
await writeIcons(sharp);
await writeOg(sharp);
