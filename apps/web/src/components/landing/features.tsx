"use client";

import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { BRAND } from "@/lib/brand";
import { MOTION_OK, ScrollTrigger, TABLET_MOTION, gsap, useGSAP } from "@/lib/motion";
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

/** Where a window sits by depth (0 = front): up and to the right, smaller, fainter (scaled from its top-right corner, so the offsets show). */
const SLOTS = [
  { x: 0, y: 0, scale: 1, opacity: 1 },
  { x: 34, y: -30, scale: 0.94, opacity: 0.7 },
  { x: 64, y: -58, scale: 0.88, opacity: 0.42 },
] as const;
/** Scroll per page while pinned, as a share of the viewport height. */
const PAGE_SCROLL = 0.8;

/**
 * 三种开始方式 (第 63 条 card swap, page turning reworked in 第 64 条): the
 * three ways as windows stacked in depth on the right.
 *
 * Paging is discrete. The scroll position (pinned, from 768 px) or a click
 * only chooses which way is in front; the swap itself is a short timeline
 * that always runs to the end — the front window drops away and slides in
 * at the back while the others step forward (or, going back, the rear
 * window lifts over the top). So a window is never left half-way, a fast
 * flick still lands on a whole page, and scrolling back reverses cleanly.
 * The pin snaps to pages; each way's bar shows how far the scroll is
 * towards it.
 *
 * Turning pages: scroll; the ways on the left; the ‹ › buttons under the
 * windows; ← / → while focus is in the section; a sideways swipe on the
 * windows (phones). Phones and reduced motion: no pin, the same discrete
 * swaps (instant under reduced motion).
 *
 * Each way's text is a disclosure (button + aria-expanded); the windows are
 * pictures of the product (aria-hidden), scenes in demos.tsx.
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
  /** The way in front; -1 until the section first comes into view. */
  const activeRef = useRef(-1);
  /** Per way: bumped each time it comes to the front, which replays its scene. */
  const [plays, setPlays] = useState([0, 0, 0]);
  const ways = wayList(samples, signedIn);
  const n = ways.length;

  /** Moves every window to its slot for `front`; animates the swap when asked. */
  const arrange = useCallback(
    (front: number, from: number | null) => {
      const box = deck.current;
      if (!box) return;
      const windows = Array.from(box.querySelectorAll<HTMLElement>("[data-window]"));
      const animate = from !== null && from !== front && window.matchMedia(MOTION_OK).matches;
      const forward = from !== null && (front - from + n) % n === 1;
      const back = from !== null && (from - front + n) % n === 1;
      windows.forEach((win, i) => {
        const depth = (i - front + n) % n;
        const slot = SLOTS[Math.min(depth, SLOTS.length - 1)] ?? SLOTS[0];
        const target = { x: slot.x, y: slot.y, scale: slot.scale, opacity: slot.opacity, rotate: 0 };
        gsap.killTweensOf(win);
        win.style.zIndex = String(10 - depth);
        win.toggleAttribute("inert", depth !== 0);
        if (!animate) {
          gsap.set(win, target);
          return;
        }
        if (forward && i === from) {
          // The old front drops away, then comes in again at the back.
          win.style.zIndex = "11";
          gsap
            .timeline()
            .to(win, { y: 70, x: -24, rotate: -4, opacity: 0, duration: 0.28, ease: "power2.in" })
            .set(win, { zIndex: 10 - depth, x: target.x + 24, y: target.y - 20, rotate: 0, scale: target.scale })
            .to(win, { ...target, duration: 0.42, ease: "power3.out" });
        } else if (back && i === front) {
          // Going back: the rear window lifts over the top and settles in front.
          gsap
            .timeline()
            .to(win, { y: SLOTS[2].y - 46, opacity: 0.9, duration: 0.24, ease: "power2.out" })
            .to(win, { ...target, duration: 0.46, ease: "power3.out" });
        } else {
          gsap.to(win, { ...target, duration: 0.55, ease: "power3.out", delay: forward ? 0.08 : 0 });
        }
      });
    },
    [n],
  );

  /** Brings way `index` to the front and plays its scene. */
  const bringForward = useCallback(
    (index: number) => {
      const from = activeRef.current;
      if (from === index) return;
      activeRef.current = index;
      setActive(index);
      setPlays((prev) => prev.map((value, i) => (i === index ? value + 1 : value)));
      arrange(index, from < 0 ? null : from);
      console.info("[landing] ways deck", { front: index, from });
    },
    [arrange],
  );

  useGSAP(
    () => {
      const bars = gsap.utils.toArray<HTMLElement>("[data-bar]", root.current);
      arrange(0, null);
      // The first scene plays when the section arrives, not on page load.
      const arrive = ScrollTrigger.create({
        trigger: root.current,
        start: "top 65%",
        once: true,
        onEnter: () => {
          if (activeRef.current < 0) {
            activeRef.current = 0;
            setPlays((prev) => prev.map((value, i) => (i === 0 ? value + 1 : value)));
          }
        },
      });
      const mm = gsap.matchMedia();
      mm.add(TABLET_MOTION, () => {
        const pin = ScrollTrigger.create({
          trigger: root.current,
          start: "top top",
          end: () => `+=${window.innerHeight * PAGE_SCROLL * (n - 1)}`,
          pin: true,
          invalidateOnRefresh: true,
          // Come to rest on a whole page.
          snap: { snapTo: 1 / (n - 1), duration: { min: 0.2, max: 0.5 }, delay: 0.12, ease: "power2.inOut" },
          onUpdate: (self) => {
            const p = self.progress * (n - 1);
            bars.forEach((bar, i) => {
              bar.style.transform = `scaleX(${(i === 0 ? 1 : gsap.utils.clamp(0, 1, p - i + 1)).toFixed(3)})`;
            });
            const page = gsap.utils.clamp(0, n - 1, Math.round(p));
            if (activeRef.current >= 0 && page !== activeRef.current) bringForward(page);
          },
        });
        pinned.current = pin;
        return () => {
          pinned.current = null;
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

  /** Pinned: scroll to the page (the swap follows). Otherwise: swap at once. */
  const go = useCallback(
    (index: number) => {
      const target = gsap.utils.clamp(0, n - 1, index);
      const st = pinned.current;
      if (!st) {
        bringForward(target);
        return;
      }
      const smooth = window.matchMedia(MOTION_OK).matches;
      window.scrollTo({ top: st.start + (target / (n - 1)) * (st.end - st.start), behavior: smooth ? "smooth" : "auto" });
    },
    [bringForward, n],
  );
  const step = (direction: 1 | -1) => go(Math.max(0, activeRef.current) + direction);

  // A sideways swipe on the windows turns the page (phones mostly).
  useEffect(() => {
    const box = deck.current;
    if (!box) return;
    let start: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      start = { x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) go(Math.max(0, activeRef.current) + (dx < 0 ? 1 : -1));
    };
    box.addEventListener("pointerdown", down);
    box.addEventListener("pointerup", up);
    return () => {
      box.removeEventListener("pointerdown", down);
      box.removeEventListener("pointerup", up);
    };
  }, [go]);

  return (
    <section
      ref={root}
      id="features"
      aria-labelledby="features-title"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          step(event.key === "ArrowRight" ? 1 : -1);
        }
      }}
      className="relative z-10 scroll-mt-20 py-24 md:flex md:h-[100dvh] md:min-h-[680px] md:items-center md:py-0 md:pt-[72px]"
    >
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-1 items-center gap-10 px-5 sm:px-8 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-[clamp(24px,4vw,72px)] lg:px-[clamp(24px,3.6vw,64px)]">
        <div>
          <RevealHeading id="features-title" className="font-display text-[clamp(44px,5vw,80px)] leading-[1.02] font-normal text-fg">
            三种开始方式
          </RevealHeading>
          <ul className="mt-8 flex flex-col">
            {ways.map((way, index) => {
              const on = index === active;
              const bodyId = `way-${way.key}`;
              return (
                <li key={way.key} className="border-t border-line py-5 last:border-b">
                  <button
                    type="button"
                    aria-expanded={on}
                    aria-controls={bodyId}
                    onClick={() => go(index)}
                    className="flex w-full items-center gap-4 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-acc"
                  >
                    <span className={cn("numeral text-[28px] tabular transition-colors", on ? "text-acc" : "text-fg-muted")}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className={cn("font-display text-[clamp(22px,2vw,30px)] transition-colors", on ? "text-fg" : "text-fg-soft")}>
                      {way.title}
                    </span>
                    <Sticker className={cn("ml-auto text-[13px] transition-opacity", on ? "opacity-100" : "opacity-0")}>
                      {way.sticker}
                    </Sticker>
                  </button>
                  <div
                    id={bodyId}
                    className={cn(
                      "grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
                      on ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                    )}
                  >
                    {/* inert while closed, so its link is not tabbed to unseen. */}
                    <div className="overflow-hidden" inert={!on}>
                      <p className="pt-3 text-[15px] leading-relaxed text-fg-soft">{way.body}</p>
                      <WayLink href={way.href}>{way.link}</WayLink>
                    </div>
                  </div>
                  <div aria-hidden className="mt-4 hidden h-[2px] overflow-hidden rounded-full bg-line md:block">
                    <div data-bar className={cn("h-full origin-left bg-acc", index === 0 ? "" : "scale-x-0")} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <div
            ref={deck}
            aria-hidden
            className="relative h-[min(92vw,460px)] touch-pan-y md:h-[min(64dvh,580px)]"
          >
            {ways.map((way, index) => (
              <div
                key={way.key}
                data-window
                className="absolute inset-0 top-[11%] right-[9%] flex origin-top-right flex-col overflow-hidden rounded-[22px] bg-panel shadow-[0_2px_4px_var(--shadow),0_50px_90px_-40px_var(--shadow-2)] ring-1 ring-line will-change-transform"
              >
                <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
                  <span className="size-2.5 rounded-full bg-acc/80" />
                  <span className="size-2.5 rounded-full bg-tint/20" />
                  <span className="size-2.5 rounded-full bg-tint/20" />
                  <span className="ml-3 truncate text-[12px] font-semibold text-fg-muted">
                    {way.sticker} · {way.title}
                  </span>
                </div>
                <div className="min-h-0 flex-1 p-3 lg:p-4">{way.demo(plays[index] ?? 0)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-3 pr-[9%]">
            <p className="numeral text-[22px] text-fg tabular" aria-live="polite">
              {String(active + 1).padStart(2, "0")}
              <span className="text-[14px] text-fg-muted"> / {String(n).padStart(2, "0")}</span>
            </p>
            <PageButton label="上一种" disabled={active === 0} onClick={() => step(-1)}>
              <ArrowLeftIcon className="sk-in size-[18px]" strokeWidth={2} />
            </PageButton>
            <PageButton label="下一种" disabled={active === n - 1} onClick={() => step(1)}>
              <ArrowRightIcon className="sk-in size-[18px]" strokeWidth={2} />
            </PageButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
  children,
}: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="glass sk flex size-11 items-center justify-center rounded-[12px] text-fg transition-[background-color,scale,opacity] hover:bg-tint/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:scale-95 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** The three ways, with the pictures each window acts out. */
function wayList(samples: ShowcaseItem[], signedIn: boolean): Way[] {
  const studio = samples.slice(0, 4);
  const board = samples.slice(4, 7);
  const kit = samples.slice(7, 9);
  const to = (path: string) => (signedIn ? path : `/login?next=${encodeURIComponent(path)}`);
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

function Sticker({ children, className }: { children: string; className?: string }) {
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
      <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
    </Link>
  );
}
