"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ArrowLeftIcon, ArrowRightIcon, WandSparklesIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { useDragScroll } from "@/hooks/use-drag-scroll";
import { cn } from "@/lib/utils";

import { SAMPLE_ALT, type ShowcaseItem } from "./showcase";

gsap.registerPlugin(useGSAP);

/**
 * Sample wall: a horizontal, draggable row of sample pictures. Hovering a
 * card tilts it toward the pointer and (after a short pause) re-lights the
 * room with it; "做同款" copies its description into the prompt box.
 */
export function GallerySection({
  items,
  onPreview,
  onUseSample,
}: {
  items: ShowcaseItem[];
  /** Re-light the room with this sample (hover / focus). */
  onPreview: (index: number) => void;
  /** Copy the sample's description into the prompt box. */
  onUseSample: (index: number) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const preview = useCallback(
    (index: number) => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      // A pause before relighting, so sweeping across the row stays calm.
      previewTimer.current = setTimeout(() => onPreview(index), 260);
    },
    [onPreview],
  );
  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    },
    [],
  );

  // Drag to scroll with a mouse; touch and trackpads scroll natively.
  useDragScroll(rail);

  const scrollBy = (direction: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section id="gallery" aria-labelledby="gallery-title" className="relative z-10 scroll-mt-20 py-24 lg:py-32">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-end justify-between gap-6 px-5 sm:px-8 lg:px-[clamp(24px,3.6vw,64px)]">
        <div>
          <h2
            id="gallery-title"
            className="font-display text-[clamp(44px,5.4vw,84px)] leading-[1.02] font-normal text-fg"
          >
            从一张<em className="text-acc not-italic">示例</em>开始
          </h2>
          <p className="mt-4 max-w-[34em] text-[16px] leading-relaxed text-fg-soft">
            点「做同款」，把它的描述填进输入框，改几个字就是你自己的版本。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="往前看"
            onClick={() => scrollBy(-1)}
            className="glass sk flex size-11 items-center justify-center rounded-[12px] text-fg transition-[background-color,scale] hover:bg-tint/[0.08] active:scale-95"
          >
            <ArrowLeftIcon className="sk-in size-[18px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="往后看"
            onClick={() => scrollBy(1)}
            className="glass sk flex size-11 items-center justify-center rounded-[12px] text-fg transition-[background-color,scale] hover:bg-tint/[0.08] active:scale-95"
          >
            <ArrowRightIcon className="sk-in size-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div
        ref={rail}
        className="mt-12 flex cursor-grab snap-x snap-mandatory scroll-px-5 items-start gap-7 overflow-x-auto px-5 pt-6 pb-10 scrollbar-hidden select-none data-[dragging=true]:cursor-grabbing data-[dragging=true]:snap-none sm:scroll-px-8 sm:px-8 lg:scroll-px-[clamp(24px,3.6vw,64px)] lg:px-[clamp(24px,3.6vw,64px)]"
      >
        {items.map((entry, index) => (
          <GalleryCard
            key={entry.id}
            item={entry}
            index={index}
            onPreview={() => preview(index)}
            onUse={() => onUseSample(index)}
          />
        ))}
      </div>
      <p className="mx-auto max-w-[1600px] px-5 text-xs text-fg-muted sm:px-8 lg:px-[clamp(24px,3.6vw,64px)]">
        以上均为示例作品
      </p>
    </section>
  );
}

function GalleryCard({
  item,
  index,
  onPreview,
  onUse,
}: {
  item: ShowcaseItem;
  index: number;
  onPreview: () => void;
  onUse: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const { contextSafe } = useGSAP({ scope: card });

  const still = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // Hover lifts the frame off the wall; it settles back with a little give.
  const lift = contextSafe(() => {
    if (!frame.current || still()) return;
    gsap.to(frame.current, { y: -10, duration: 0.5, ease: "power3.out", overwrite: "auto" });
  });
  const settle = contextSafe(() => {
    if (!frame.current) return;
    gsap.to(frame.current, { y: 0, duration: 0.8, ease: "elastic.out(1, 0.6)", overwrite: "auto" });
  });

  const wide = item.ratio === "4:3";
  return (
    <article
      ref={card}
      onPointerEnter={() => {
        onPreview();
        lift();
      }}
      onPointerLeave={settle}
      onFocus={onPreview}
      className={cn(
        "group relative shrink-0 snap-start",
        wide ? "w-[min(82vw,460px)]" : "w-[min(64vw,290px)]",
      )}
    >
      <div ref={frame} className="relative">
        <div
          className={cn(
            "sk-frame rounded-[18px] shadow-[0_22px_40px_-26px_var(--shadow-2)] transition-shadow duration-500 group-hover:shadow-[0_34px_60px_-28px_var(--shadow-2)]",
            wide ? "aspect-[4/3]" : "aspect-[3/4]",
          )}
        >
          {/* biome-ignore lint/performance/noImgElement: static export */}
          <img
            src={item.src}
            alt={`${SAMPLE_ALT}：${item.prompt}`}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-full w-full object-cover"
            style={{ objectPosition: item.focus }}
          />
        </div>
        <span
          aria-hidden
          className="numeral absolute -top-4 right-3 text-[44px] text-fg/90 [text-shadow:0_2px_0_var(--ground)]"
        >
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <p className="mt-4 line-clamp-2 pr-2 text-[14px] leading-[1.6] font-medium text-fg">{item.prompt}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="data-label text-fg-muted tabular">{item.ratio}</span>
        <button
          type="button"
          onClick={onUse}
          className="sk inline-flex h-8 items-center rounded-[9px] bg-acc-soft px-3 text-[12.5px] font-semibold text-acc-text transition-[background-color,color,scale] hover:bg-acc hover:text-acc-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:scale-[0.97]"
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
