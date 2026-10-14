"use client";

import { useRef } from "react";

import { KNOWN_IMAGE_MODELS } from "@/lib/image-model-meta";
import { MOTION_OK, ScrollTrigger, gsap, useGSAP } from "@/lib/motion";

import { RevealHeading } from "./reveal-heading";

/**
 * Models the main site can route to. The heading sticks while the list goes
 * by; rows wipe in once as a list. Only the note that sets a model apart is
 * shown (「效果优先」); resolution and quality tiers live in the studio's
 * pickers, where they apply (第 62 条).
 */
export function ModelsSection() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const rows = gsap.utils.toArray<HTMLElement>("[data-model-row]", root.current);
        gsap.set(rows, { clipPath: "inset(0 100% 0 0)", x: -16 });
        ScrollTrigger.batch(rows, {
          start: "top 88%",
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, {
              clipPath: "inset(0 0% 0 0)",
              x: 0,
              duration: 0.8,
              ease: "expo.out",
              stagger: 0.06,
              clearProps: "clipPath,transform",
            }),
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} id="models" aria-labelledby="models-title" className="relative z-10 scroll-mt-20 pb-24 lg:pb-32">
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-10 px-5 sm:px-8 lg:grid-cols-12 lg:px-[clamp(24px,3.6vw,64px)]">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            <RevealHeading id="models-title" className="font-display text-[clamp(36px,3.6vw,56px)] leading-tight font-normal text-fg">
              能用哪些模型
            </RevealHeading>
            <p className="mt-3 max-w-[24em] text-[15px] leading-relaxed text-fg-soft">
              以你的 Key 所在分组为准。
            </p>
          </div>
        </div>
        <ul className="divide-y divide-line border-y border-line lg:col-span-8">
          {KNOWN_IMAGE_MODELS.map((model) => (
            <li
              key={model.id}
              data-model-row
              className="group flex items-baseline gap-3 py-5 transition-colors"
            >
              <span
                aria-hidden
                className="font-display text-[18px] text-acc opacity-0 transition-[opacity,translate] duration-300 group-hover:translate-x-0 group-hover:opacity-100 -translate-x-2"
              >
                /
              </span>
              <span className="text-[clamp(19px,1.6vw,24px)] leading-tight font-bold tracking-[-0.01em] text-fg transition-transform duration-300 group-hover:translate-x-1">
                {model.displayName}
              </span>
              <span className="shrink-0 text-[13px] text-fg-muted">{model.maker}</span>
              {/* The name wraps on a phone; the maker and the note stay whole. */}
              {model.note ? (
                <span className="ml-auto shrink-0 text-[13.5px] font-medium whitespace-nowrap text-fg-soft">
                  {model.note}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
