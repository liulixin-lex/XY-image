// Builds apps/web/.impeccable/design.json (impeccable sidecar, schemaVersion 2)
// from DESIGN.md: colour metadata and tonal ramps from the frontmatter
// `colors`, the narrative (north star, rules, do's and don'ts) verbatim from
// the body, plus shadow / motion tokens and self-contained component snippets
// that mirror src/app/globals.css and components/ui/*.
// Re-run after editing DESIGN.md:  node scripts/build-design-sidecar.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(path.join(root, "DESIGN.md"), "utf8");
const [, front, ...rest] = md.split(/^---$/m);
const body = rest.join("---");

// sRGB hex -> OKLCH
function hexToOklch(hex) {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, Bb);
  const H = ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360;
  return { L, C, H };
}
const fmt = ({ L, C, H }) => `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})`;
const ramp = (hex) => {
  const { C, H } = hexToOklch(hex);
  return Array.from({ length: 8 }, (_, i) => fmt({ L: 0.15 + (0.8 * i) / 7, C, H }));
};
/** "#rrggbb" or "rgb(r g b / a)" -> "#rrggbb" (alpha dropped for the ramp). */
const toHex = (value) => {
  if (value.startsWith("#")) return value;
  const m = value.match(/rgb\((\d+) (\d+) (\d+)/);
  return m ? `#${m.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, "0")).join("")}` : null;
};

// Frontmatter colours: `  key: "value"` lines under `colors:`.
const colors = [];
let inColors = false;
for (const line of front.split("\n")) {
  if (/^colors:/.test(line)) inColors = true;
  else if (/^\S/.test(line)) inColors = false;
  else if (inColors) {
    const m = line.match(/^ {2}([\w-]+): "([^"]+)"/);
    if (m) colors.push([m[1], m[2]]);
  }
}
const DISPLAY = {
  coral: "珊瑚 Coral",
  "coral-dark": "珊瑚（暗色）",
  "coral-text": "珊瑚文字",
  "amb-default": "环境色 · 默认",
  "amb-2-default": "环境色 · 默认第二色",
  wall: "粉灰墙 Wall",
  floor: "地面 Floor",
  panel: "面板 Panel",
  well: "凹槽 Well",
  fg: "石墨紫墨 Ink",
  "fg-soft": "次级字",
  "fg-muted": "弱字",
  "wall-dark": "深紫黑墙（暗色）",
  "floor-dark": "地面（暗色）",
  "panel-dark": "面板（暗色）",
  "fg-dark": "近白墨（暗色）",
  warn: "待核对 Warn",
  alert: "失败 Alert",
  ok: "成功 Ok",
};
const role = (key) =>
  key.startsWith("coral")
    ? "primary"
    : key.startsWith("amb")
      ? "secondary"
      : /^(warn|alert|ok)/.test(key)
        ? "status"
        : "neutral";
const colorMeta = Object.fromEntries(
  colors.flatMap(([key, value]) => {
    const hex = toHex(value);
    if (!hex) return [];
    // Keep the alpha of translucent tokens (lines, washes, glass) in the canonical value.
    const alpha = value.match(/\/\s*([\d.]+)\)/)?.[1];
    const canonical = fmt(hexToOklch(hex)).replace(/\)$/, alpha ? ` / ${alpha})` : ")");
    return [[key, { role: role(key), displayName: DISPLAY[key] ?? key, canonical, tonalRamp: ramp(hex) }]];
  }),
);

const typographyMeta = {
  display: { displayName: "Display · 优设标题黑", purpose: "落地页首屏「一句话」，只此一处。" },
  headline: { displayName: "Headline", purpose: "工作台页头和落地页分区标题。" },
  "section-label": { displayName: "Section label", purpose: "「/ 提示词」这类分区名和字段名，主按钮标签。" },
  numeral: { displayName: "Numeral · Big Shoulders", purpose: "张数、画质档位、余额、序号、计时；只排数字。" },
  title: { displayName: "Title", purpose: "卡片和弹窗标题。" },
  body: { displayName: "Body", purpose: "说明文字，最长约 34em。" },
  "body-sm": { displayName: "Body small", purpose: "工作台正文和输入。" },
  label: { displayName: "Label", purpose: "按钮、页签、分段选项。" },
  data: { displayName: "Data · Geist Mono", purpose: "请求 ID、比例、模型名。" },
};

const shadows = [
  ["subtle", "0 1px 2px var(--shadow)", "小控件。"],
  ["card", "0 1px 2px var(--shadow), 0 22px 40px -26px var(--shadow-2)", "结果卡片和面板。"],
  ["card-hover", "0 2px 4px var(--shadow), 0 30px 50px -24px var(--shadow-2)", "卡片悬停。"],
  ["float", "0 6px 14px var(--shadow), 0 30px 64px -20px var(--shadow-2)", "漂浮的工具条和菜单。"],
  ["accent-pool", "0 14px 30px -12px var(--acc-glow)", "珊瑚主按钮下的一汪光。"],
  ["picked", "0 0 0 3px var(--ground), 0 0 0 5px var(--acc), 0 26px 46px -22px var(--acc-glow)", "被选中的那张图。"],
  ["lit", "0 2px 4px var(--shadow), 0 50px 80px -40px var(--shadow-2)", "立在房间里的大图；暗色再加 0 0 140px -30px rgb(var(--amb) / 0.6) 的环境光。"],
  ["glass-strong", "inset 0 1px 0 var(--glass-highlight), 0 4px 12px -2px var(--shadow), 0 30px 70px -24px var(--shadow-2)", "菜单和弹窗，配 blur(24px) saturate(140%)。"],
].map(([name, value, purpose]) => ({ name, value, purpose }));

const motion = [
  ["ease-out-expo", "cubic-bezier(0.16, 1, 0.3, 1)", "入场和大图换位。"],
  ["ease-out-quart", "cubic-bezier(0.25, 1, 0.5, 1)", "面板和浮层。"],
  ["press", "150ms ease-out; active: translateY(1px) scale(0.98)", "按钮按下。"],
  ["ambient", "GSAP 0.9s", "换图时墙、地面、光晕、斜块过渡到新的环境色。"],
  ["live-pulse", "1.8s ease-in-out infinite", "生成中的状态点，唯一循环的光。"],
  ["progress-travel", "1.8s cubic-bezier(0.45, 0, 0.25, 1) infinite", "已发出的请求：进度条往复，不显示假的百分比。"],
  ["reduced-motion", "none", "prefers-reduced-motion 下全部直接显示最终状态。"],
].map(([name, value, purpose]) => ({ name, value, purpose }));

const breakpoints = [["sm", "640px"], ["md", "768px"], ["lg", "1024px"], ["xl", "1280px"], ["2xl", "1536px"]].map(([name, value]) => ({ name, value }));

const arrow = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
const font = 'Geist, "Noto Sans SC", "PingFang SC", system-ui, sans-serif';
const display = '"GGUU Display", "Noto Sans SC", "PingFang SC", system-ui, sans-serif';
const numeral = '"Big Shoulders Display", Geist, system-ui, sans-serif';
const components = [
  {
    name: "Poster Button",
    kind: "button",
    refersTo: "button-poster",
    description: "珊瑚斜切主按钮：每屏最要紧的那个动作，下面一汪珊瑚光。",
    html: `<button class="ds-btn-poster"><span class="ds-sk-in">生成 <b class="ds-num">2</b> 张 ${arrow}</span></button>`,
    css: `.ds-btn-poster{display:inline-flex;align-items:center;justify-content:center;height:52px;padding:0 28px;border:none;border-radius:14px;background:var(--acc,#e5533d);color:var(--acc-ink,#fff);font:400 21px/1 ${display};letter-spacing:.02em;transform:skewX(-10deg);box-shadow:0 14px 30px -12px var(--acc-glow,rgb(229 83 61/.42));cursor:pointer;transition:background-color .15s ease-out,transform .15s ease-out}.ds-btn-poster:hover{background:var(--acc-hover,#d6452f)}.ds-btn-poster:active{transform:skewX(-10deg) translateY(1px) scale(.98)}.ds-btn-poster:focus-visible{outline:2px solid var(--acc,#e5533d);outline-offset:2px}.ds-sk-in{display:inline-flex;align-items:center;gap:8px;transform:skewX(10deg)}.ds-num{font:800 28px/.9 ${numeral}}`,
  },
  {
    name: "Ink Button",
    kind: "button",
    refersTo: "button-ink",
    description: "墨色按钮：强的次要动作，暗色主题自动反色。",
    html: '<button class="ds-btn-ink">去设置</button>',
    css: `.ds-btn-ink{height:36px;padding:0 14px;border:none;border-radius:10px;background:var(--fg,#24212b);color:var(--ground,#f5f2f3);font:500 14px/1 ${font};cursor:pointer;transition:background-color .15s ease-out}.ds-btn-ink:hover{background:color-mix(in oklab,var(--fg,#24212b) 88%,transparent)}.ds-btn-ink:focus-visible{outline:2px solid var(--acc,#e5533d);outline-offset:2px}`,
  },
  {
    name: "Outline Button",
    kind: "button",
    refersTo: "button-outline",
    description: "安静的动作：细描边，悬停加一层叠加色。",
    html: '<button class="ds-btn-outline">用作参考图</button>',
    css: `.ds-btn-outline{height:36px;padding:0 14px;border:1px solid var(--line-strong,rgb(36 33 43/.18));border-radius:10px;background:transparent;color:var(--fg,#24212b);font:500 14px/1 ${font};cursor:pointer;transition:background-color .15s ease-out}.ds-btn-outline:hover{background:rgb(var(--tint,36 33 43)/.05)}.ds-btn-outline:focus-visible{outline:2px solid var(--acc,#e5533d);outline-offset:2px}`,
  },
  {
    name: "Nav Tabs",
    kind: "nav",
    refersTo: "nav-tab-active",
    description: "顶部导航：斜切页签，当前页墨色底。",
    html: '<nav class="ds-nav" aria-label="主导航"><a class="ds-tab" aria-current="page" href="#"><span>生图</span></a><a class="ds-tab" href="#"><span>画布项目</span></a><a class="ds-tab" href="#"><span>设置</span></a></nav>',
    css: `.ds-nav{display:flex;gap:4px}.ds-tab{display:inline-flex;align-items:center;height:34px;padding:0 13px;border-radius:10px;transform:skewX(-10deg);color:var(--fg-soft,#5c5766);font:600 13.5px/1 ${font};text-decoration:none;transition:background-color .15s,color .15s}.ds-tab>span{transform:skewX(10deg)}.ds-tab:hover{background:rgb(var(--tint,36 33 43)/.06);color:var(--fg,#24212b)}.ds-tab[aria-current=page]{background:var(--fg,#24212b);color:var(--ground,#f5f2f3)}.ds-tab:focus-visible{outline:2px solid var(--acc,#e5533d);outline-offset:2px}`,
  },
  {
    name: "Segmented Choice",
    kind: "chip",
    refersTo: "segmented-option-active",
    description: "画质 1K / 2K / 4K：斜切分段，选中是墨色，数字用 Big Shoulders。",
    html: '<div class="ds-seg" role="radiogroup" aria-label="画质"><button role="radio" aria-checked="false">1K</button><button role="radio" aria-checked="true">2K</button><button role="radio" aria-checked="false">4K</button></div>',
    css: `.ds-seg{display:flex;gap:6px;width:320px}.ds-seg button{flex:1;height:48px;border:none;border-radius:10px;transform:skewX(-10deg);background:rgb(var(--tint,36 33 43)/.055);color:var(--fg-soft,#5c5766);font:800 26px/.9 ${numeral};cursor:pointer;transition:background-color .15s,color .15s}.ds-seg button:hover{background:rgb(var(--tint,36 33 43)/.09);color:var(--fg,#24212b)}.ds-seg button[aria-checked=true]{background:var(--fg,#24212b);color:var(--ground,#f5f2f3)}.ds-seg button:focus-visible{outline:2px solid var(--acc,#e5533d);outline-offset:2px}`,
  },
  {
    name: "Prompt Field",
    kind: "input",
    refersTo: "input-field",
    description: "字段名带珊瑚斜杠；输入区是凹下去的底，聚焦珊瑚内描边。",
    html: '<label class="ds-field"><span class="ds-label">提示词</span><textarea rows="3" placeholder="写下你想要的画面"></textarea></label>',
    css: `.ds-field{display:grid;gap:10px;width:340px}.ds-label{font:400 17px/1 ${display};letter-spacing:.02em;color:var(--fg,#24212b)}.ds-label::before{content:"/";color:var(--acc,#e5533d);margin-right:.12em}.ds-field textarea{resize:none;padding:12px 14px;border:none;border-radius:14px;background:var(--well,#f0ecee);color:var(--fg,#24212b);font:400 15px/1.7 ${font};caret-color:var(--acc,#e5533d);box-shadow:inset 0 0 0 1px var(--line,rgb(36 33 43/.1));outline:none;transition:box-shadow .15s}.ds-field textarea::placeholder{color:var(--fg-muted,#6f6a78)}.ds-field textarea:focus{box-shadow:inset 0 0 0 1px var(--acc,#e5533d),0 0 0 3px var(--acc-soft,rgb(229 83 61/.11))}`,
  },
  {
    name: "Result Card",
    kind: "card",
    refersTo: "card",
    description: "结果图卡：14px 圆角，选中时墙色缝加珊瑚外圈。",
    html: '<figure class="ds-result" aria-label="第 1 张（已选中）"><div class="ds-pic"></div><figcaption><b class="ds-idx">01</b><span>3:4 · 2K · GPT Image 2</span></figcaption></figure>',
    css: `.ds-result{margin:0;width:200px;display:grid;gap:10px}.ds-pic{aspect-ratio:3/4;border-radius:14px;background:linear-gradient(135deg,rgb(var(--amb,224 122 102)),rgb(var(--amb-2,196 70 128)));box-shadow:0 0 0 3px var(--ground,#f5f2f3),0 0 0 5px var(--acc,#e5533d),0 26px 46px -22px var(--acc-glow,rgb(229 83 61/.42))}.ds-result figcaption{display:flex;align-items:baseline;justify-content:space-between;color:var(--fg-muted,#6f6a78);font:400 11px/1.3 "Geist Mono",ui-monospace,monospace}.ds-idx{font:800 26px/.9 ${numeral};color:var(--fg,#24212b)}`,
  },
  {
    name: "Status Sticker",
    kind: "custom",
    refersTo: "sticker",
    description: "珊瑚贴纸，微旋转；状态牌永远带文字。",
    html: '<div class="ds-stickers"><span class="ds-sticker">示例作品</span><span class="ds-flag">待核对</span></div>',
    css: `.ds-stickers{display:flex;gap:14px;align-items:center}.ds-sticker{display:inline-block;padding:8px 14px;border-radius:10px;transform:rotate(-6deg);background:var(--acc,#e5533d);color:var(--acc-ink,#fff);font:400 17px/1 ${display};box-shadow:0 14px 30px -12px var(--acc-glow,rgb(229 83 61/.42))}.ds-flag{display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:7px;background:var(--warn-wash,rgb(185 86 15/.1));color:var(--warn,#b9560f);font:600 12px/1 ${font}}`,
  },
];

// Narrative, verbatim from DESIGN.md.
const section = (name) => {
  const m = body.match(new RegExp(`^## ${name}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"));
  return m ? m[1] : "";
};
const overview = section("Overview");
const northStar = overview.match(/Creative North Star: "([^"]+)"/)?.[1];
const paragraphs = overview
  .split(/\n\n+/)
  .map((p) => p.trim())
  .filter((p) => p && !p.startsWith("**Creative") && !p.startsWith("**Key") && !p.startsWith("- "));
const keyCharacteristics = (overview.split("**Key Characteristics:**")[1] ?? "")
  .split("\n")
  .filter((l) => l.startsWith("- "))
  .map((l) => l.slice(2).trim());
const rules = [];
for (const [sec, tag] of [["Colors", "colors"], ["Typography", "typography"], ["Elevation & Depth", "elevation"], ["Shapes", "shapes"]]) {
  for (const m of section(sec).matchAll(/\*\*(The [^*]+? Rule)\.\*\* ([^\n]+)/g)) rules.push({ name: m[1], body: m[2].trim(), section: tag });
}
const dd = section("Do's and Don'ts");
const bullets = (head) =>
  (dd.split(`### ${head}`)[1] ?? "")
    .split(/\n### /)[0]
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());

const out = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  title: "Design System: GGUU AI IMAGE",
  extensions: { colorMeta, typographyMeta, shadows, motion, breakpoints },
  components,
  narrative: { northStar, overview: paragraphs.join("\n\n"), keyCharacteristics, rules, dos: bullets("Do:"), donts: bullets("Don't:") },
};
writeFileSync(path.join(root, ".impeccable/design.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log("[design-sidecar] colors", Object.keys(colorMeta).length, "rules", rules.length, "dos", out.narrative.dos.length, "donts", out.narrative.donts.length, "kc", keyCharacteristics.length, "north", northStar);
