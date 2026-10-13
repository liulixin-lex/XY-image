"use client";

import { useRef } from "react";

import { DESKTOP_MOTION, gsap, useGSAP } from "@/lib/motion";

/**
 * The real 生图 page, shown in a screen that starts tilted back and lays
 * itself flat as you scroll to it (Aceternity Container Scroll Animation),
 * while the heading drifts up. Screenshots: public/images/product/studio-
 * {light,dark}.webp, taken from a local fixture whose prompts match their
 * pictures, with the top bar (and its balance) cropped off. Reduced motion
 * and small screens: the screen lies flat.
 */
export function ProductScreen() {
  const root = useRef<HTMLElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(DESKTOP_MOTION, () => {
        const scrub = {
          trigger: root.current,
          start: "top bottom",
          end: "center center",
          scrub: 0.6,
        };
        gsap.fromTo(
          screen.current,
          {
            rotationX: 32,
            scale: 1.04,
            yPercent: 6,
            transformPerspective: 1600,
            transformOrigin: "50% 0%",
          },
          {
            rotationX: 0,
            scale: 1,
            yPercent: 0,
            ease: "none",
            scrollTrigger: scrub,
          },
        );
        gsap.fromTo(
          head.current,
          { y: 60 },
          { y: -20, ease: "none", scrollTrigger: scrub },
        );
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section
      ref={root}
      aria-labelledby="screen-title"
      className="relative z-10 py-24 lg:py-32"
    >
      <div className="mx-auto max-w-[1600px] px-5 sm:px-8 lg:px-[clamp(24px,3.6vw,64px)]">
        <div ref={head} className="text-center">
          <h2
            id="screen-title"
            className="font-display text-[clamp(40px,4.6vw,72px)] leading-[1.04] font-normal text-fg"
          >
            生图页<em className="text-acc not-italic">长这样</em>
          </h2>
          <p className="mx-auto mt-4 max-w-[30em] text-[16px] leading-relaxed text-fg-soft">
            左边写描述、选比例和画质，右边是每一次生成的结果。
          </p>
        </div>
        <div
          ref={screen}
          className="mx-auto mt-12 max-w-[1180px] rounded-[26px] bg-[#24212b] p-2.5 shadow-[0_2px_4px_var(--shadow),0_60px_100px_-50px_var(--shadow-2)] sm:p-3.5 dark:bg-[#0f0e13]"
        >
          <div className="overflow-hidden rounded-[18px]">
            {/* biome-ignore lint/performance/noImgElement: static export */}
            <img
              src="/images/product/studio-light.webp"
              alt="生图页：左边是描述、模型、比例和画质，右边是生成结果"
              width={1440}
              height={836}
              loading="lazy"
              decoding="async"
              className="block h-auto w-full dark:hidden"
            />
            {/* biome-ignore lint/performance/noImgElement: static export */}
            <img
              src="/images/product/studio-dark.webp"
              alt="生图页：左边是描述、模型、比例和画质，右边是生成结果"
              width={1440}
              height={836}
              loading="lazy"
              decoding="async"
              className="hidden h-auto w-full dark:block"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
