"use client";

import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useRef, useState } from "react";

import { BRAND } from "@/lib/brand";
import { ScrollTrigger, TABLET_MOTION, gsap, useGSAP } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { CanvasDemo, StudioDemo, TemplateDemo } from "./demos";
import { RevealHeading } from "./reveal-heading";
import type { ShowcaseItem } from "./showcase";

type Way = {
  key: "studio" | "canvas" | "template";
  sticker: string;
  title: string;
  body: string;
  href: string;
  link: string;
  demo: (play: number) => ReactNode;
};

/**
 * 三种开始方式 (第 63 条; the user picked it from recorded previews, after
 * React Bits Card Swap): the three ways as windows stacked in depth on the
 * right, slanted, one behind the other. From 768 px the section pins and
 * scrolling drops the front window down and slides it in at the back,
 * bringing the next way forward to act out its scene (demos.tsx). On the
 * left the three ways follow, each with a bar that fills while it is in
 * front; clicking one scrolls to it. Phones: the list and the front window
 * only; tapping a way brings its window forward.
 *
 * Each way's text is a disclosure (button + aria-expanded); the windows are
 * pictures of the product (aria-hidden). Reduced motion: no pinning, the
 * same tap-to-switch as phones, scenes shown finished.
 *
 * TODO(agent01): keep these sentences in step with the studio (multi-model,
 * 局部重绘 / 扩图), the canvas (agent tool cap per turn) and templates /
 * brand kits (第 58 条).
 */
export function FeaturesSection({
  samples,
  signedIn,
}: { samples: ShowcaseItem[]; signedIn: boolean }) {
  const root = useRef<HTMLElement>(null);
  const deck = useRef<HTMLDivElement>(null);
  const pinned = useRef<ScrollTrigger | null>(null);
  const [active, setActive] = useState(0);
  /** -1 until the section first comes into view; then the way in front. */
  const activeRef = useRef(-1);
  /** Per way: bumped each time it comes to the front, which replays its scene. */
  const [plays, setPlays] = useState([0, 0, 0]);
  const ways = wayList(samples, signedIn);
  const n = ways.length;

  const bringForward = useCallback((index: number) => {
    if (activeRef.current === index) return;
    activeRef.current = index;
    setActive(index);
    setPlays((prev) =>
      prev.map((value, i) => (i === index ? value + 1 : value)),
    );
  }, []);

  useGSAP(
    () => {
      const box = deck.current;
      if (!box) return;
      const windows = Array.from(
        box.querySelectorAll<HTMLElement>("[data-window]"),
      );
      const bars = gsap.utils.toArray<HTMLElement>("[data-bar]", root.current);
      // The first scene plays when the section arrives, not on page load.
      const arrive = ScrollTrigger.create({
        trigger: root.current,
        start: "top 60%",
        once: true,
        onEnter: () => {
          if (activeRef.current < 0) bringForward(0);
        },
      });
      const mm = gsap.matchMedia();
      mm.add(TABLET_MOTION, () => {
        box.dataset.mode = "deck";
        const state = { p: 0 };
        // Slot k (0 = front) sits up and to the right, further back.
        const slot = (k: number) => ({
          x: k * 46,
          y: -k * 40,
          z: -k * 90,
          o: 1 - k * 0.18,
        });
        const apply = () => {
          windows.forEach((win, i) => {
            // t: how many slots behind the front this window is (0 … n).
            const t = (((i - state.p) % n) + n) % n;
            let x: number;
            let y: number;
            let z: number;
            let o: number;
            let layer: number;
            if (t <= n - 1) {
              // Moving forward one slot at a time.
              const k = Math.floor(t);
              const f = t - k;
              const a = slot(k);
              const b = slot(Math.min(n - 1, k + 1));
              x = a.x + (b.x - a.x) * f;
              y = a.y + (b.y - a.y) * f;
              z = a.z + (b.z - a.z) * f;
              o = a.o + (b.o - a.o) * f;
              layer = 10 - Math.round(t * 2);
            } else {
              // Leaving the front: drops down and comes back in at the back.
              const f = n - t;
              const a = slot(0);
              const b = slot(n - 1);
              x = a.x + (b.x - a.x) * f;
              y = a.y + (b.y - a.y) * f + Math.sin(Math.PI * f) * 420;
              z = a.z + (b.z - a.z) * f;
              o = 1 - Math.sin(Math.PI * f) * 0.35;
              layer = f < 0.5 ? 11 : 1;
            }
            win.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) skewY(4deg)`;
            win.style.opacity = o.toFixed(3);
            win.style.zIndex = String(layer);
          });
          if (activeRef.current >= 0) bringForward(Math.round(state.p) % n);
          bars.forEach((bar, i) => {
            bar.style.transform = `scaleX(${gsap.utils.clamp(0, 1, state.p - i + 0.5).toFixed(3)})`;
          });
        };
        const tween = gsap.to(state, {
          p: n - 1,
          ease: "none",
          onUpdate: apply,
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: () => `+=${window.innerHeight * 1.6}`,
            pin: true,
            scrub: 0.6,
            invalidateOnRefresh: true,
            // Come to rest with one window squarely in front.
            snap: {
              snapTo: 1 / (n - 1),
              duration: { min: 0.2, max: 0.6 },
              delay: 0.08,
              ease: "power2.inOut",
            },
          },
        });
        pinned.current = tween.scrollTrigger ?? null;
        apply();
        console.info("[landing] ways deck pinned", { windows: windows.length });
        return () => {
          pinned.current = null;
          delete box.dataset.mode;
          for (const win of windows) {
            win.style.transform = "";
            win.style.opacity = "";
            win.style.zIndex = "";
          }
          for (const bar of bars) bar.style.transform = "";
        };
      });
      return () => {
        arrive.kill();
        mm.revert();
      };
    },
    { scope: root },
  );

  /** Pinned: scroll to the way's stop. Otherwise: swap the front window. */
  const pick = (index: number) => {
    const st = pinned.current;
    if (!st) {
      bringForward(index);
      return;
    }
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    window.scrollTo({
      top: st.start + (index / (n - 1)) * (st.end - st.start),
      behavior: smooth ? "smooth" : "auto",
    });
  };

  return (
    <section
      ref={root}
      id="features"
      aria-labelledby="features-title"
      className="relative z-10 scroll-mt-20 py-24 md:flex md:h-[100dvh] md:min-h-[680px] md:items-center md:py-0 md:pt-[72px]"
    >
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-1 items-center gap-10 px-5 sm:px-8 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-[clamp(24px,4vw,72px)] lg:px-[clamp(24px,3.6vw,64px)]">
        <div>
          <RevealHeading
            id="features-title"
            className="font-display text-[clamp(44px,5vw,80px)] leading-[1.02] font-normal text-fg"
          >
            三种开始方式
          </RevealHeading>
          <ul className="mt-8 flex flex-col">
            {ways.map((way, index) => {
              const on = index === active;
              const bodyId = `way-${way.key}`;
              return (
                <li
                  key={way.key}
                  className="border-t border-line py-5 last:border-b"
                >
                  <button
                    type="button"
                    aria-expanded={on}
                    aria-controls={bodyId}
                    onClick={() => pick(index)}
                    className="flex w-full items-center gap-4 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-acc"
                  >
                    <span
                      className={cn(
                        "numeral text-[28px] tabular transition-colors",
                        on ? "text-acc" : "text-fg-muted",
                      )}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={cn(
                        "font-display text-[clamp(22px,2vw,30px)] transition-colors",
                        on ? "text-fg" : "text-fg-soft",
                      )}
                    >
                      {way.title}
                    </span>
                    <Sticker
                      className={cn(
                        "ml-auto text-[13px] transition-opacity",
                        on ? "opacity-100" : "opacity-0",
                      )}
                    >
                      {way.sticker}
                    </Sticker>
                  </button>
                  <div
                    id={bodyId}
                    className={cn(
                      "grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
                      on
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0",
                    )}
                  >
                    {/* inert while closed, so its link is not tabbed to unseen. */}
                    <div className="overflow-hidden" inert={!on}>
                      <p className="pt-3 text-[15px] leading-relaxed text-fg-soft">
                        {way.body}
                      </p>
                      <WayLink href={way.href}>{way.link}</WayLink>
                    </div>
                  </div>
                  <div
                    aria-hidden
                    className="mt-4 hidden h-[2px] overflow-hidden rounded-full bg-line md:block"
                  >
                    <div
                      data-bar
                      className="h-full origin-left scale-x-0 bg-acc"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div
          ref={deck}
          aria-hidden
          className="relative h-[min(86vw,440px)] md:h-[min(62dvh,560px)] md:[perspective:1600px] md:[transform-style:preserve-3d]"
        >
          {ways.map((way, index) => (
            <div
              key={way.key}
              data-window
              className={cn(
                "absolute inset-0 flex flex-col overflow-hidden rounded-[22px] bg-panel shadow-[0_2px_4px_var(--shadow),0_50px_90px_-40px_var(--shadow-2)] ring-1 ring-line md:top-[10%] md:right-[8%] md:bottom-0",
                // Without the deck (phones, reduced motion) only the front window shows.
                index === active ? "" : "[[data-mode=deck]_&]:flex hidden",
              )}
            >
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <span className="size-2.5 rounded-full bg-acc/80" />
                <span className="size-2.5 rounded-full bg-tint/20" />
                <span className="size-2.5 rounded-full bg-tint/20" />
                <span className="ml-3 text-[12px] font-semibold text-fg-muted">
                  {way.sticker}
                </span>
              </div>
              <div className="min-h-0 flex-1 p-3 lg:p-4">
                {way.demo(plays[index] ?? 0)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The three ways, with the pictures each window acts out. */
function wayList(samples: ShowcaseItem[], signedIn: boolean): Way[] {
  const studio = samples.slice(0, 4);
  const board = samples.slice(4, 7);
  const kit = samples.slice(7, 9);
  const to = (path: string) =>
    signedIn ? path : `/login?next=${encodeURIComponent(path)}`;
  return [
    {
      key: "studio",
      sticker: "生图",
      title: "一句话出图",
      body: "写一句描述，选比例和画质，一次出多张，也可以几个模型同时出图对比。满意的那张接着改：做参考、出变体、局部重绘或扩图。",
      href: to("/studio"),
      link: "打开生图",
      demo: (play) => <StudioDemo samples={studio} play={play} />,
    },
    {
      key: "canvas",
      sticker: "画布",
      title: `画布和${BRAND.agentName}`,
      body: `在无限画布上跟${BRAND.agentName}说需求，它会先想好画面，再连续出图、排到画布上。也可以自己用节点，把描述、参考图和生成连起来。`,
      href: to("/projects"),
      link: "打开画布",
      demo: (play) => <CanvasDemo samples={board} play={play} />,
    },
    {
      key: "template",
      sticker: "模板",
      title: "模板和品牌套件",
      body: "不会写描述，就从模板开始，填几个空就是一段完整的描述。选上品牌套件，每张图都带上你的配色和标志。",
      href: to("/studio"),
      link: "去生图页用模板",
      demo: (play) => <TemplateDemo samples={kit} play={play} />,
    },
  ];
}

function Sticker({
  children,
  className,
}: { children: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit -rotate-3 rounded-[9px] bg-acc px-3 py-1.5 font-display text-[16px] leading-none text-acc-ink shadow-acc",
        className,
      )}
    >
      {children}
    </span>
  );
}

function WayLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="group mt-4 inline-flex w-fit items-center gap-1.5 rounded-md text-[15px] font-semibold text-fg underline decoration-line-strong underline-offset-[6px] transition-colors hover:decoration-acc"
    >
      {children}
      <ArrowRightIcon
        className="size-4 transition-transform group-hover:translate-x-0.5"
        strokeWidth={2}
      />
    </Link>
  );
}
