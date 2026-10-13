"use client";

import { ArrowLeftIcon, ArrowRightIcon, WandSparklesIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDragScroll } from "@/hooks/use-drag-scroll";
import { DESKTOP_MOTION, ScrollTrigger, gsap, isLiteRender, useGSAP } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { SAMPLE_ALT, type ShowcaseItem } from "./showcase";

/**
 * Sample wall (第 62 条): one row of samples that moves sideways.
 *
 * Wide screens: the section pins and scrolling down slides the row left.
 * Cards turn on a shared perspective as they pass the middle (a coverflow:
 * the one in the middle faces you, the others turn away and sink back), the
 * card in the middle re-lights the room, and a ruler under the row shows
 * where you are. Arrows, ruler ticks and keyboard focus scroll the page to
 * the right card, so the row and the page never disagree.
 *
 * Phones, tablets and prefers-reduced-motion: a native horizontal scroller
 * with snap points (drag with a mouse); the same ruler follows it.
 *
 * Lite render tier (software compositing): the row still pins and slides,
 * without the per-card 3D.
 */
export function GallerySection({
  items,
  onPreview,
  onUseSample,
}: {
  items: ShowcaseItem[];
  /** Re-light the room with this sample (the one in the middle). */
  onPreview: (index: number) => void;
  /** Copy the sample's description into the prompt box. */
  onUseSample: (index: number) => void;
}) {
  const section = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const pinned = useRef<ScrollTrigger | null>(null);
  const [active, setActive] = useState(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-light after the row settles on a card, so sweeping past stays calm.
  const settleOn = useCallback(
    (index: number) => {
      setActive((prev) => (prev === index ? prev : index));
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(() => onPreview(index), 220);
    },
    [onPreview],
  );
  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    },
    [],
  );

  // Rail mode only: mouse drag (the hook is a no-op while the row is clipped).
  useDragScroll(viewport);

  useGSAP(
    () => {
      const vp = viewport.current;
      const row = track.current;
      if (!vp || !row) return;
      const cards = Array.from(row.querySelectorAll<HTMLElement>("[data-card]"));
      const mm = gsap.matchMedia();

      mm.add(DESKTOP_MOTION, () => {
        vp.dataset.mode = "pin";
        const flat = isLiteRender();
        const distance = () => Math.max(0, row.scrollWidth - vp.clientWidth);
        // Card centres along the row, measured once per refresh.
        let centres: number[] = [];
        const measure = () => {
          centres = cards.map((card) => card.offsetLeft + card.offsetWidth / 2);
        };
        const place = () => {
          const x = Number(gsap.getProperty(row, "x")) || 0;
          const half = vp.clientWidth / 2;
          let nearest = 0;
          let best = Number.POSITIVE_INFINITY;
          centres.forEach((centre, index) => {
            const offset = (centre + x - half) / half; // -1 … 1 across the viewport
            if (Math.abs(offset) < best) {
              best = Math.abs(offset);
              nearest = index;
            }
            if (flat) return;
            const d = gsap.utils.clamp(-1.5, 1.5, offset);
            const card = cards[index];
            if (!card) return;
            card.style.transform = `translate3d(0,0,${(-Math.abs(d) * 170).toFixed(1)}px) rotateY(${(d * -30).toFixed(2)}deg)`;
            card.style.opacity = String(1 - Math.max(0, Math.abs(d) - 0.9) * 0.55);
          });
          settleOn(nearest);
        };

        const tween = gsap.to(row, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: section.current,
            start: "top top",
            end: () => `+=${distance()}`,
            pin: true,
            scrub: 0.7,
            invalidateOnRefresh: true,
            onRefresh: () => {
              measure();
              place();
            },
            onUpdate: place,
          },
        });
        pinned.current = tween.scrollTrigger ?? null;
        measure();
        place();
        console.info("[landing] sample rail pinned", { cards: cards.length, flat });

        return () => {
          pinned.current = null;
          delete vp.dataset.mode;
          for (const card of cards) {
            card.style.transform = "";
            card.style.opacity = "";
          }
        };
      });

      // Rail mode: follow the native scroller.
      mm.add("(prefers-reduced-motion: reduce), (max-width: 1023px)", () => {
        let frame = 0;
        const onScroll = () => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            const middle = vp.scrollLeft + vp.clientWidth / 2;
            let nearest = 0;
            let best = Number.POSITIVE_INFINITY;
            cards.forEach((card, index) => {
              const distanceToMiddle = Math.abs(card.offsetLeft + card.offsetWidth / 2 - middle);
              if (distanceToMiddle < best) {
                best = distanceToMiddle;
                nearest = index;
              }
            });
            settleOn(nearest);
          });
        };
        vp.addEventListener("scroll", onScroll, { passive: true });
        return () => {
          cancelAnimationFrame(frame);
          vp.removeEventListener("scroll", onScroll);
        };
      });
      return () => mm.revert();
    },
    { scope: section, dependencies: [items.length] },
  );

  /** Bring card `index` to the middle: page scroll when pinned, row scroll otherwise. */
  const goTo = useCallback((index: number, smooth = true) => {
    const vp = viewport.current;
    const row = track.current;
    const card = row?.querySelectorAll<HTMLElement>("[data-card]")[index];
    if (!vp || !row || !card) return;
    const behavior: ScrollBehavior =
      smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto";
    const st = pinned.current;
    if (st) {
      const span = Math.max(1, row.scrollWidth - vp.clientWidth);
      const x = gsap.utils.clamp(0, span, card.offsetLeft + card.offsetWidth / 2 - vp.clientWidth / 2);
      window.scrollTo({ top: st.start + (x / span) * (st.end - st.start), behavior });
    } else {
      vp.scrollTo({ left: card.offsetLeft - (vp.clientWidth - card.offsetWidth) / 2, behavior });
    }
  }, []);

  const step = (direction: 1 | -1) => goTo(gsap.utils.clamp(0, items.length - 1, active + direction));

  return (
    <section
      ref={section}
      id="gallery"
      aria-labelledby="gallery-title"
      className="relative z-10 flex scroll-mt-0 flex-col py-24 lg:h-[100dvh] lg:min-h-[720px] lg:justify-center lg:py-0 lg:pt-[72px]"
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-end justify-between gap-6 px-5 sm:px-8 lg:px-[clamp(24px,3.6vw,64px)]">
        <div>
          <h2
            id="gallery-title"
            className="font-display text-[clamp(44px,5vw,80px)] leading-[1.02] font-normal text-fg"
          >
            从一张<em className="text-acc not-italic">示例</em>开始
          </h2>
          <p className="mt-4 max-w-[34em] text-[16px] leading-relaxed text-fg-soft">
            点「做同款」，描述会填进输入框。
          </p>
        </div>
        <div className="flex items-end gap-5">
          <p aria-live="polite" className="numeral text-[clamp(40px,4.4vw,56px)] text-fg tabular">
            {String(active + 1).padStart(2, "0")}
            <span className="text-[0.42em] text-fg-muted">/{String(items.length).padStart(2, "0")}</span>
          </p>
          <div className="flex gap-2 pb-1.5">
            <button
              type="button"
              aria-label="上一张"
              disabled={active === 0}
              onClick={() => step(-1)}
              className="glass sk flex size-11 items-center justify-center rounded-[12px] text-fg transition-[background-color,scale,opacity] hover:bg-tint/[0.08] active:scale-95 disabled:opacity-40"
            >
              <ArrowLeftIcon className="sk-in size-[18px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="下一张"
              disabled={active === items.length - 1}
              onClick={() => step(1)}
              className="glass sk flex size-11 items-center justify-center rounded-[12px] text-fg transition-[background-color,scale,opacity] hover:bg-tint/[0.08] active:scale-95 disabled:opacity-40"
            >
              <ArrowRightIcon className="sk-in size-[18px]" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={viewport}
        className="rail-viewport mt-10 cursor-grab select-none data-[mode=pin]:cursor-auto lg:mt-[clamp(24px,4dvh,48px)]"
      >
        <div
          ref={track}
          className="rail-track flex w-max items-start gap-7 px-5 pt-4 pb-6 sm:px-8 lg:gap-[clamp(28px,3vw,48px)] lg:px-[max(clamp(24px,3.6vw,64px),calc(50vw-min(15vw,170px)))]"
        >
          {items.map((entry, index) => (
            <GalleryCard
              key={entry.id}
              item={entry}
              index={index}
              current={index === active}
              onUse={() => onUseSample(index)}
              onFocus={() => {
                if (pinned.current) goTo(index, false);
              }}
            />
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1600px] px-5 sm:px-8 lg:px-[clamp(24px,3.6vw,64px)]">
        <Ruler count={items.length} active={active} onPick={goTo} />
      </div>
    </section>
  );
}

/** One tick per sample; the current one is coral and taller. */
function Ruler({ count, active, onPick }: { count: number; active: number; onPick: (index: number) => void }) {
  return (
    <div role="group" aria-label="跳到某一张" className="flex h-8 items-end gap-[7px]">
      {Array.from({ length: count }, (_, index) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: ticks are positions, not items
          key={index}
          type="button"
          aria-label={`第 ${index + 1} 张`}
          aria-current={index === active || undefined}
          onClick={() => onPick(index)}
          className="group flex h-full w-3 items-end justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
        >
          <span
            className={cn(
              "block w-[2px] rounded-full transition-[height,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
              index === active ? "h-7 bg-acc" : "h-3 bg-line-strong group-hover:h-5 group-hover:bg-fg-muted",
            )}
          />
        </button>
      ))}
    </div>
  );
}

function GalleryCard({
  item,
  index,
  current,
  onUse,
  onFocus,
}: {
  item: ShowcaseItem;
  index: number;
  current: boolean;
  onUse: () => void;
  onFocus: () => void;
}) {
  const wide = item.ratio === "4:3";
  return (
    <article
      data-card
      onFocus={onFocus}
      className="rail-card group relative shrink-0"
      aria-label={`示例 ${index + 1}`}
    >
      <div
        className={cn(
          "sk-frame rounded-[18px] transition-shadow duration-500",
          current ? "shadow-lit" : "shadow-[0_22px_40px_-26px_var(--shadow-2)]",
          wide
            ? "aspect-[4/3] h-[min(62vw,340px)] lg:h-[min(40dvh,420px)]"
            : "aspect-[3/4] h-[min(86vw,400px)] lg:h-[min(46dvh,480px)]",
        )}
      >
        {/* biome-ignore lint/performance/noImgElement: static export */}
        <img
          src={item.src}
          srcSet={`${item.src} 600w, ${item.large} 1200w`}
          sizes="(min-width: 1024px) 30vw, 70vw"
          alt={`${SAMPLE_ALT}：${item.prompt}`}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover"
          style={{ objectPosition: item.focus }}
        />
      </div>
      <div className="mt-4 flex max-w-full items-start justify-between gap-3" style={{ width: "100%" }}>
        <p className="line-clamp-2 min-w-0 flex-1 text-[14px] leading-[1.6] font-medium text-fg">{item.prompt}</p>
        <button
          type="button"
          onClick={onUse}
          className="sk inline-flex h-8 shrink-0 items-center rounded-[9px] bg-acc-soft px-3 text-[12.5px] font-semibold text-acc-text transition-[background-color,color,scale] hover:bg-acc hover:text-acc-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:scale-[0.97]"
        >
          <span className="sk-in gap-1.5">
            <WandSparklesIcon className="size-3.5" strokeWidth={2} />
            做同款
          </span>
        </button>
      </div>
    </article>
  );
}
