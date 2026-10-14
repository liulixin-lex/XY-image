"use client";

import { type CSSProperties, useRef } from "react";

import { MOTION_OK, gsap, useGSAP } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { ShowcaseItem } from "./showcase";

/**
 * Live miniatures of the three ways to start (第 63 条): the studio, the
 * canvas and the template gallery, each acting out one short scene whenever
 * `play` changes to a new non-zero value (typing a description, pictures
 * developing, wires drawing); 0 leaves the finished picture. They are
 * pictures of the product, not controls: aria-hidden, no focusable
 * elements; the real pages are one click away.
 *
 * Layout (第 64 条): every scene fills the height it is given. Text blocks
 * keep their natural height and the pictures take what is left (flex,
 * min-h-0, object-cover), so nothing is pushed out of a short window — the
 * 品牌套件 card used to be cut off at the bottom of the 模板 window.
 *
 * Every scene ends in the same state the static markup shows, so reduced
 * motion, a scene that never plays and server rendering all look finished.
 * Only transform, opacity and clip-path move.
 */

/** Replays `build` from the start whenever `play` changes to a non-zero value. */
function useScene(
  play: number,
  build: (tl: gsap.core.Timeline, q: (selector: string) => Element[]) => void,
) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (!play || !root.current) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const q = gsap.utils.selector(root);
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        build(tl, q);
        // A scene cut short (the window went to the back) still ends finished.
        return () => tl.progress(1);
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [play] },
  );
  return root;
}

/** Types `text` into the element's textContent over the tween's span. */
function typeInto(
  tl: gsap.core.Timeline,
  el: Element | undefined,
  text: string,
  at: number | string,
  duration: number,
) {
  if (!el) return;
  el.textContent = "";
  const state = { n: 0 };
  tl.fromTo(
    state,
    { n: 0 },
    {
      n: text.length,
      duration,
      ease: "none",
      onUpdate: () => {
        el.textContent = text.slice(0, Math.round(state.n));
      },
      onComplete: () => {
        el.textContent = text;
      },
    },
    at,
  );
}

function Picture({
  item,
  className,
  style,
}: { item: ShowcaseItem; className?: string; style?: CSSProperties }) {
  return (
    // biome-ignore lint/performance/noImgElement: static export
    <img
      src={item.src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn("h-full w-full object-cover", className)}
      style={{ objectPosition: item.focus, ...style }}
    />
  );
}

const CARD = "rounded-[14px] bg-panel shadow-[0_10px_24px_-18px_var(--shadow-2)]";

/** The studio: a description typed, settings set, four pictures developing. */
export function StudioDemo({
  samples,
  play,
}: { samples: ShowcaseItem[]; play: number }) {
  const prompt = samples[0]?.title
    ? `${samples[0].title}，胶片质感，电影光`
    : "雾中山谷，胶片质感，电影光";
  const root = useScene(play, (tl, q) => {
    typeInto(tl, q("[data-type]")[0], prompt, 0.15, 1.3);
    tl.from(q("[data-chip]"), { y: 8, opacity: 0, stagger: 0.07, duration: 0.4 }, 1.1)
      .fromTo(
        q("[data-go]"),
        { scale: 1 },
        { scale: 0.93, duration: 0.12, yoyo: true, repeat: 1, ease: "power1.inOut" },
        1.7,
      )
      .from(q("[data-scan]"), { opacity: 0, duration: 0.25, stagger: 0.05 }, 1.85)
      .fromTo(
        q("[data-pic]"),
        { clipPath: "inset(100% 0% 0% 0%)" },
        { clipPath: "inset(0% 0% 0% 0%)", duration: 0.75, stagger: 0.32, ease: "power2.inOut" },
        2.6,
      )
      .from(q("[data-ring]"), { opacity: 0, scale: 0.94, duration: 0.4 }, 4.2);
  });
  return (
    <div
      ref={root}
      aria-hidden
      className="flex h-full min-h-0 flex-col gap-4 rounded-[18px] bg-well p-4 select-none sm:p-5"
    >
      <div className={cn(CARD, "shrink-0 px-4 py-3")}>
        <span className="poster-label text-[12px] text-fg-muted">描述</span>
        <p className="mt-1 min-h-[1.6em] truncate text-[14px] leading-relaxed text-fg">
          <span data-type>{prompt}</span>
          <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse bg-acc" />
        </p>
      </div>
      {/* The batch takes whatever height is left. */}
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-2.5 sm:gap-3">
        {samples.slice(0, 4).map((item, index) => (
          <div key={item.id} className="relative min-h-0">
            <div className="sk-frame relative h-full rounded-[12px] bg-panel">
              <span data-scan aria-hidden className="gen-scan" />
              <div data-pic className="absolute inset-0">
                <Picture item={item} />
              </div>
            </div>
            {index === 0 ? (
              <span
                data-ring
                className="ring-picked pointer-events-none absolute inset-0 -skew-x-[8deg] rounded-[12px]"
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {["3:4", "4K", "质量高", "GPT Image 2.5"].map((chip) => (
          <span
            key={chip}
            data-chip
            className="sk inline-flex h-[28px] items-center rounded-[9px] bg-tint/[0.06] px-3 text-[12px] font-semibold text-fg-soft tabular"
          >
            <span className="sk-in">{chip}</span>
          </span>
        ))}
        <span
          data-go
          className="sk ml-auto inline-flex h-10 items-center rounded-[12px] bg-acc px-4 font-display text-[16px] text-acc-ink shadow-acc"
        >
          <span className="sk-in gap-1">
            生成<span className="numeral text-[19px]">4</span>张
          </span>
        </span>
      </div>
    </div>
  );
}

/** The canvas: a description wired to a generator, three results, a chat request. */
export function CanvasDemo({
  samples,
  play,
}: { samples: ShowcaseItem[]; play: number }) {
  const request = "再来三张，换成冷色调";
  const root = useScene(play, (tl, q) => {
    tl.from(q("[data-node=prompt]"), { y: 14, opacity: 0, duration: 0.5 }, 0.1)
      .fromTo(
        q("[data-wire=in]"),
        { strokeDashoffset: 1 },
        { strokeDashoffset: 0, duration: 0.5, ease: "power2.inOut" },
        0.55,
      )
      .from(q("[data-node=gen]"), { scale: 0.7, opacity: 0, duration: 0.45, ease: "back.out(2)" }, 0.9)
      .fromTo(
        q("[data-wire=out]"),
        { strokeDashoffset: 1 },
        { strokeDashoffset: 0, duration: 0.55, stagger: 0.12, ease: "power2.inOut" },
        1.35,
      )
      .from(
        q("[data-node=result]"),
        { scale: 0.6, opacity: 0, rotate: -6, duration: 0.55, stagger: 0.14, ease: "back.out(1.7)" },
        1.75,
      )
      .from(q("[data-bubble]"), { y: 12, opacity: 0, duration: 0.4 }, 2.6);
    typeInto(tl, q("[data-type]")[0], request, 2.75, 0.9);
  });
  return (
    <div
      ref={root}
      aria-hidden
      className="relative h-full min-h-[240px] overflow-hidden rounded-[18px] bg-well bg-[radial-gradient(rgb(var(--tint)/0.14)_1px,transparent_1px)] [background-size:20px_20px] select-none"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 700 320"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        fill="none"
        strokeWidth="2"
      >
        <path data-wire="in" pathLength={1} strokeDasharray="1" d="M206 102 C 250 102, 240 160, 286 160" stroke="var(--acc)" />
        <path data-wire="out" pathLength={1} strokeDasharray="1" d="M402 160 C 440 160, 436 73, 474 73" stroke="var(--line-strong)" />
        <path data-wire="out" pathLength={1} strokeDasharray="1" d="M402 160 C 480 160, 520 156, 586 156" stroke="var(--line-strong)" />
        <path data-wire="out" pathLength={1} strokeDasharray="1" d="M402 160 C 440 160, 436 246, 474 246" stroke="var(--line-strong)" />
      </svg>
      <div data-node="prompt" className="glass absolute top-[18%] left-[3%] w-[27%] rounded-[12px] p-3">
        <span className="poster-label text-[13px] text-fg">描述</span>
        <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-[1.55] text-fg-soft">{samples[0]?.title}</p>
      </div>
      <div
        data-node="gen"
        className="absolute top-[41%] left-[41%] flex h-[19%] min-w-[16.5%] items-center justify-center gap-1 rounded-[12px] bg-fg px-3 font-display text-[15px] whitespace-nowrap text-ground shadow-[0_14px_24px_-14px_var(--shadow-2)]"
      >
        生成<span className="numeral text-[18px]">×3</span>
      </div>
      {samples.slice(0, 3).map((item, index) => (
        <figure
          key={item.id}
          data-node="result"
          className="sk-frame absolute m-0 h-[30%] w-[13%] rounded-[10px] shadow-[0_14px_24px_-14px_var(--shadow-2)]"
          style={CANVAS_LAYOUT[index]}
        >
          <Picture item={item} />
        </figure>
      ))}
      <div
        data-bubble
        className="glass-strong absolute right-[3%] bottom-[5%] max-w-[min(250px,44%)] rounded-[14px] rounded-br-[4px] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-fg"
      >
        <span data-type>{request}</span>
      </div>
    </div>
  );
}

/** Where the three results sit on the board (fractions of the board). */
const CANVAS_LAYOUT: CSSProperties[] = [
  { left: "68%", top: "6%" },
  { left: "84%", top: "34%" },
  { left: "68%", top: "60%" },
];

/** A template filled in, then a brand kit's colours, each with its picture. */
export function TemplateDemo({
  samples,
  play,
}: { samples: ShowcaseItem[]; play: number }) {
  const [first, second] = samples;
  const fields = [
    ["人物", "短发女孩，琥珀色眼睛"],
    ["光线", "黄金时刻逆光"],
    ["镜头感", "85mm 人像"],
  ] as const;
  const root = useScene(play, (tl, q) => {
    q("[data-field]").forEach((el, index) => {
      typeInto(tl, el, fields[index]?.[1] ?? "", 0.2 + index * 0.55, 0.5);
    });
    tl.fromTo(
      q("[data-pic=a]"),
      { clipPath: "inset(0% 0% 100% 0%)" },
      { clipPath: "inset(0% 0% 0% 0%)", duration: 0.8, ease: "power2.inOut" },
      1.9,
    )
      .from(q("[data-swatch]"), { y: -14, opacity: 0, stagger: 0.07, duration: 0.4, ease: "back.out(2)" }, 2.5)
      .fromTo(
        q("[data-pic=b]"),
        { clipPath: "inset(0% 100% 0% 0%)" },
        { clipPath: "inset(0% 0% 0% 0%)", duration: 0.8, ease: "power2.inOut" },
        3.0,
      )
      .from(q("[data-stamp]"), { scale: 1.6, opacity: 0, rotate: 12, duration: 0.45, ease: "back.out(2.2)" }, 3.6);
  });
  return (
    <div
      ref={root}
      aria-hidden
      className="grid h-full min-h-0 grid-cols-2 gap-3 rounded-[18px] bg-well p-4 select-none sm:gap-4 sm:p-5"
    >
      {/* Left: the template's fields, then the portrait they describe. */}
      <div className="flex min-h-0 flex-col gap-3">
        <div className={cn(CARD, "shrink-0 p-3.5")}>
          <span className="poster-label text-[13px] text-fg">写实人像</span>
          <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
            {fields.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-fg-muted">{label}</dt>
                <dd data-field className="min-h-[1.5em] truncate border-b border-dashed border-line-strong text-fg">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        {first ? (
          <div data-pic="a" className="sk-frame min-h-0 flex-1 rounded-[12px] shadow-[0_18px_30px_-18px_var(--shadow-2)]">
            <Picture item={first} />
          </div>
        ) : null}
      </div>
      {/* Right: the brand-kit picture, then the kit itself, both inside the window. */}
      <div className="flex min-h-0 flex-col gap-3">
        {second ? (
          <div className="relative min-h-0 flex-1">
            <div data-pic="b" className="sk-frame h-full rounded-[12px] shadow-[0_18px_30px_-18px_var(--shadow-2)]">
              <Picture item={second} />
            </div>
            <span
              data-stamp
              className="absolute right-2 bottom-2 flex size-8 -rotate-6 items-center justify-center rounded-[9px] bg-acc font-display text-[12px] text-acc-ink shadow-acc"
            >
              G
            </span>
          </div>
        ) : null}
        <div className={cn(CARD, "shrink-0 p-3.5")}>
          <span className="poster-label text-[13px] text-fg">品牌套件</span>
          <div className="mt-2.5 flex gap-1.5">
            {["#d4412a", "#24212b", "#f1e3d3", "#2f6f68", "#e9b44c"].map((colour) => (
              <span key={colour} data-swatch className="h-6 flex-1 rounded-[6px]" style={{ background: colour }} />
            ))}
          </div>
          <p className="mt-2 text-[12px] text-fg-muted">配色 · 标志 · 调性</p>
        </div>
      </div>
    </div>
  );
}
