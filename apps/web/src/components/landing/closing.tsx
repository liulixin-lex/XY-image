"use client";

import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { useAuth } from "@/lib/auth-context";
import { BRAND } from "@/lib/brand";
import { DESKTOP_MOTION, gsap, useGSAP } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { BrandLockup } from "../brand/brand-mark";
import { SAMPLE_ALT, type ShowcaseItem } from "./showcase";

/**
 * The closing poster: the call to action, and a fan of three samples (the
 * one on show in the hero in front) that opens in 3D as the poster scrolls
 * into view (scrubbed; DESKTOP_MOTION only, otherwise the fan stands open).
 */
export function Closing({
  registerUrl,
  mainSiteUrl,
  sample,
  fan,
  onWrite,
}: {
  registerUrl: string | null;
  mainSiteUrl: string | null;
  /** The sample on show in the hero; the front card of the fan. */
  sample: ShowcaseItem;
  /** Two more samples behind it. */
  fan: [ShowcaseItem, ShowcaseItem];
  /** Scroll back up to the prompt box. */
  onWrite: () => void;
}) {
  const { user } = useAuth();
  const poster = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(DESKTOP_MOTION, () => {
        const cards = gsap.utils.toArray<HTMLElement>("[data-fan]", poster.current);
        // The fan's resting spread is CSS (rotate / translate); this starts each
        // card folded back onto the front one and lets the transform go.
        gsap.from(cards, {
          rotation: (index) => [11, -9, 0][index] ?? 0,
          xPercent: (index) => [34, -30, 0][index] ?? 0,
          yPercent: 14,
          rotationY: -24,
          transformPerspective: 1400,
          ease: "none",
          scrollTrigger: { trigger: poster.current, start: "top bottom", end: "center center", scrub: 0.6 },
        });
      });
      return () => mm.revert();
    },
    { scope: poster },
  );
  return (
    <>
      <section aria-labelledby="closing-title" className="relative z-10 pt-8 pb-24 lg:pt-12 lg:pb-32">
        <div className="mx-auto max-w-[1600px] px-5 sm:px-8 lg:px-[clamp(24px,3.6vw,64px)]">
          {/* An inked poster: graphite in light, pale in dark; the coral action reads on both. */}
          <div
            ref={poster}
            className="relative grid overflow-hidden rounded-[24px] bg-fg text-ground shadow-[0_40px_80px_-40px_var(--shadow-2)] lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]"
          >
            <div className="relative z-[1] flex flex-col gap-10 px-7 py-14 sm:px-12 lg:px-16 lg:py-20">
              <h2 id="closing-title" className="font-display text-[clamp(52px,6.4vw,104px)] leading-[1.02] font-normal">
                写一句话，
                <br />
                先试<em className="text-acc-inverse not-italic">一张</em>
              </h2>
              <div className="flex flex-col items-start gap-5">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={onWrite}
                    className="sk inline-flex h-14 items-center rounded-[14px] bg-acc px-7 font-display text-[21px] text-acc-ink shadow-acc transition-[background-color,scale] hover:bg-acc-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:scale-[0.98]"
                  >
                    <span className="sk-in gap-2">
                      去写描述
                      <ArrowRightIcon className="size-5" strokeWidth={2.4} />
                    </span>
                  </button>
                  <Link
                    href={user ? "/studio" : "/login"}
                    className="sk inline-flex h-14 items-center rounded-[14px] bg-ground/10 px-7 text-[15px] font-semibold text-ground ring-1 ring-ground/25 transition-colors ring-inset hover:bg-ground/16 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
                  >
                    <span className="sk-in">{user ? "进入工作台" : "用主站账号登录"}</span>
                  </Link>
                </div>
                {registerUrl && !user ? (
                  <a
                    href={registerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[14px] text-ground/75 underline decoration-ground/30 underline-offset-4 transition-colors hover:text-ground hover:decoration-ground"
                  >
                    还没有主站账号？先去注册
                    <ArrowUpRightIcon className="size-3.5" />
                  </a>
                ) : null}
              </div>
            </div>
            {/* Three samples fanned out, the one on show in front, cut by the poster's edge. */}
            <div aria-hidden className="relative hidden min-h-[460px] lg:block">
              {[fan[0], fan[1], sample].map((item, index) => (
                <div
                  key={`${item.id}-${index}`}
                  data-fan
                  className="absolute top-[16%] left-[22%] h-[96%] w-[58%]"
                  style={{ rotate: `${[-11, 9, -2][index]}deg`, translate: `${[-34, 30, 0][index]}% ${[8, 4, 0][index]}%` }}
                >
                  <div
                    className={cn(
                      "sk-frame h-full w-full rounded-[24px]",
                      index === 2 ? "shadow-[0_30px_60px_-30px_rgb(0_0_0/0.65)]" : "opacity-80 shadow-[0_20px_40px_-24px_rgb(0_0_0/0.5)]",
                    )}
                  >
                    {/* biome-ignore lint/performance/noImgElement: static export */}
                    <img
                      src={item.src}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                      style={{ objectPosition: item.focus }}
                    />
                  </div>
                </div>
              ))}
              <span className="absolute top-[11%] left-[58%] -rotate-6 rounded-[10px] bg-acc px-3.5 py-2 font-display text-[17px] leading-none text-acc-ink shadow-acc">
                {SAMPLE_ALT}
              </span>
            </div>
          </div>
        </div>
      </section>
      <footer className="relative z-10 border-t border-line">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-5 py-8 text-sm text-fg-muted sm:px-8 md:flex-row md:items-center md:justify-between lg:px-[clamp(24px,3.6vw,64px)]">
          <BrandLockup compact />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {mainSiteUrl ? (
              <a href={mainSiteUrl} target="_blank" rel="noreferrer" className="transition-colors hover:text-fg">
                主站
              </a>
            ) : null}
            <Link href="/login" className="transition-colors hover:text-fg">
              登录
            </Link>
            <span>© 2026 {BRAND.name}</span>
          </div>
        </div>
      </footer>
    </>
  );
}
