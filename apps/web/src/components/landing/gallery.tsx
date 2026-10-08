"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ArrowLeftIcon, ArrowRightIcon, WandSparklesIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

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
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    let startX = 0;
    let startScroll = 0;
    let dragging = false;
    let moved = false;
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startScroll = el.scrollLeft;
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      if (moved) {
        el.scrollLeft = startScroll - dx;
        el.dataset.dragging = "true";
      }
    };
    const up = () => {
      dragging = false;
      delete el.dataset.dragging;
    };
    // Swallow the click that ends a drag so it does not trigger a card.
    const click = (event: MouseEvent) => {
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        moved = false;
      }
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("click", click, true);
    };
  }, []);

  const scrollBy = (direction: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section id="gallery" aria-labelledby="gallery-title" className="relative z-10 scroll-mt-6 py-24 lg:py-32">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-end justify-between gap-6 px-5 sm:px-8 lg:px-[clamp(24px,4.4vw,96px)]">
        <div>
          <h2
            id="gallery-title"
            className="font-display text-[clamp(40px,4.6vw,68px)] leading-[1.02] text-fg"
          >
            从一张示例开始
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
            className="glass flex size-11 items-center justify-center rounded-full text-fg transition-colors hover:bg-white/[0.12]"
          >
            <ArrowLeftIcon className="size-4.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="往后看"
            onClick={() => scrollBy(1)}
            className="glass flex size-11 items-center justify-center rounded-full text-fg transition-colors hover:bg-white/[0.12]"
          >
            <ArrowRightIcon className="size-4.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div
        ref={rail}
        className="mt-12 flex cursor-grab snap-x snap-mandatory scroll-px-5 gap-5 overflow-x-auto px-5 pt-6 pb-10 scrollbar-hidden select-none data-[dragging=true]:cursor-grabbing data-[dragging=true]:snap-none sm:scroll-px-8 sm:px-8 lg:scroll-px-[clamp(24px,4.4vw,96px)] lg:px-[clamp(24px,4.4vw,96px)]"
        style={{ perspective: "1400px" }}
      >
        {items.map((entry, index) => (
          <GalleryCard
            key={entry.id}
            item={entry}
            onPreview={() => preview(index)}
            onUse={() => onUseSample(index)}
          />
        ))}
      </div>
      <p className="mx-auto max-w-[1600px] px-5 text-xs text-fg-muted sm:px-8 lg:px-[clamp(24px,4.4vw,96px)]">
        以上均为示例作品
      </p>
    </section>
  );
}

function GalleryCard({
  item,
  onPreview,
  onUse,
}: {
  item: ShowcaseItem;
  onPreview: () => void;
  onUse: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  const { contextSafe } = useGSAP({ scope: card });

  const reduced = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const tilt = contextSafe((event: React.PointerEvent) => {
    const el = card.current;
    if (!el || reduced()) return;
    const rect = el.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    gsap.to(el, {
      rotationY: x * 10,
      rotationX: -y * 8,
      y: -8,
      duration: 0.6,
      ease: "power3.out",
      overwrite: "auto",
    });
  });

  const settle = contextSafe(() => {
    const el = card.current;
    if (!el) return;
    gsap.to(el, { rotationY: 0, rotationX: 0, y: 0, duration: 0.8, ease: "expo.out", overwrite: "auto" });
  });

  const wide = item.ratio === "4:3";
  return (
    <article
      ref={card}
      onPointerEnter={onPreview}
      onPointerMove={tilt}
      onPointerLeave={settle}
      onFocus={onPreview}
      className={cn(
        "group relative shrink-0 snap-start overflow-hidden rounded-[18px] shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_40px_70px_-36px_rgb(2_4_10/0.9)] transition-shadow duration-500 [transform-style:preserve-3d] hover:shadow-[0_0_0_1px_rgb(255_255_255/0.2),0_50px_90px_-30px_rgb(2_4_10/0.95),0_0_80px_-16px_rgb(var(--amb)/0.55)]",
        wide ? "aspect-[4/3] w-[min(82vw,480px)]" : "aspect-[3/4] w-[min(64vw,300px)]",
      )}
    >
      {/* biome-ignore lint/performance/noImgElement: static export */}
      <img
        src={item.src}
        alt={`${SAMPLE_ALT}：${item.prompt}`}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
      />
      <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,rgb(6_9_18/0.92),rgb(6_9_18/0.55)_55%,transparent)] px-4 pt-14 pb-4">
        <p className="line-clamp-2 text-[13.5px] leading-[1.6] text-fg">{item.prompt}</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="data-label text-fg-muted">{item.ratio}</span>
          <button
            type="button"
            onClick={onUse}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-fg px-3 text-[12.5px] font-semibold text-ground opacity-90 transition-[opacity,transform] hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amb active:scale-[0.97]"
          >
            <WandSparklesIcon className="size-3.5" strokeWidth={2} />
            做同款
          </button>
        </div>
      </div>
    </article>
  );
}
