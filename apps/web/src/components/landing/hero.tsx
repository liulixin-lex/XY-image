"use client";

import { forwardRef } from "react";

import type { AspectRatio } from "@/lib/image-model-meta";
import { cn } from "@/lib/utils";

import { LightScreen } from "../ambient/light-screen";
import { PromptBox, type PromptBoxHandle } from "./prompt-box";
import { SAMPLE_ALT, type ShowcaseItem } from "./showcase";

/**
 * First viewport: the 氛围屏 room. A sample picture hangs on a tilted
 * screen at the right and lights the whole page; the headline and the
 * working prompt box sit at the left, the box overlapping the screen's
 * near edge. Thumbnails on the floor switch the picture (and the light).
 *
 * Geometry is driven by two custom properties so the screen, its floor
 * line and the thumbnail strip stay in register at any desktop width:
 * --screen-w (width) and --screen-top.
 */
export const Hero = forwardRef<
  PromptBoxHandle,
  {
    items: ShowcaseItem[];
    selected: number;
    onSelect: (index: number) => void;
    prompt: string;
    onPromptChange: (value: string) => void;
    ratio: AspectRatio;
    onRatioChange: (ratio: AspectRatio) => void;
    quality: "standard" | "hd";
    onQualityChange: (quality: "standard" | "hd") => void;
  }
>(function Hero(
  {
    items,
    selected,
    onSelect,
    prompt,
    onPromptChange,
    ratio,
    onRatioChange,
    quality,
    onQualityChange,
  },
  ref,
) {
  const current = items[selected] ?? items[0]!;
  const strip = items.slice(0, 6);
  const screenImage = {
    src: current.large,
    srcSet: `${current.src} 540w, ${current.large} 900w`,
    alt: `${SAMPLE_ALT}：${current.prompt}`,
    focus: current.focus,
  };

  return (
    <section
      aria-label="开始生成"
      className="relative isolate overflow-hidden lg:min-h-[max(100dvh,780px)]"
      style={
        {
          "--screen-w": "min(54.2vw, 1040px)",
          "--screen-top": "clamp(88px, 10.7vh, 120px)",
          "--screen-h": "calc(var(--screen-w) / 1.393)",
        } as React.CSSProperties
      }
    >
      {/* Floor: a faint band of the room's light under the screen. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 hidden border-t border-white/[0.05] bg-[linear-gradient(to_bottom,rgb(var(--amb)/0.10),transparent_70%)] lg:block"
        style={{ top: "calc(var(--screen-top) + var(--screen-h) + 34px)" }}
      />

      {/* Desktop screen */}
      <LightScreen
        image={screenImage}
        eager
        className="absolute top-[var(--screen-top)] left-[44.4%] z-[1] hidden h-[var(--screen-h)] w-[var(--screen-w)] lg:block"
        sizes="(min-width: 1024px) 56vw, 100vw"
      >
        <ScreenTag prompt={current.prompt} />
      </LightScreen>

      <div className="relative z-10 mx-auto max-w-[1600px] px-5 pt-[112px] pb-14 sm:px-8 lg:px-[clamp(24px,4.4vw,96px)] lg:pt-[clamp(140px,18.7vh,190px)] lg:pb-0">
        <h1 className="font-display text-[clamp(52px,7.8vw,128px)] leading-[0.98] font-normal tracking-[-0.01em] text-fg [text-shadow:0_8px_40px_rgb(6_9_18/0.55)]">
          想到什么，
          <br />
          就
          <span className="text-[color-mix(in_oklab,rgb(var(--amb))_42%,white)] transition-colors duration-700">
            生成
          </span>
          什么
        </h1>
        <p className="mt-6 max-w-[26em] text-[16px] leading-[1.75] text-fg-soft sm:text-[18px]">
          主站账号直接登录，按次从主站余额扣费。
          <br className="hidden sm:block" />
          每张图都带请求 ID，在主站账单里查得到。
        </p>

        <PromptBox
          ref={ref}
          value={prompt}
          onChange={onPromptChange}
          ratio={ratio}
          onRatioChange={onRatioChange}
          quality={quality}
          onQualityChange={onQualityChange}
          className="mt-9 w-full max-w-[min(760px,52vw)] max-lg:max-w-none"
        />

        {/* Mobile and tablet: the screen sits below the prompt box. */}
        <div className="mt-10 lg:hidden">
          <LightScreen
            image={screenImage}
            tilt={-8}
            pitch={1}
            interactive={false}
            reflection={false}
            className="aspect-[4/3] w-full"
            sizes="100vw"
          >
            <ScreenTag prompt={current.prompt} />
          </LightScreen>
        </div>
      </div>

      <Thumbnails
        items={strip}
        selected={selected}
        onSelect={onSelect}
        className="relative z-10 px-5 pb-12 sm:px-8 lg:absolute lg:left-[64%] lg:px-0 lg:pb-0"
      />
    </section>
  );
});

function ScreenTag({ prompt }: { prompt: string }) {
  return (
    <div className="glass absolute top-5 left-5 flex max-w-[calc(100%-40px)] items-center gap-2 rounded-full py-1.5 pr-3.5 pl-2.5 text-[12.5px] font-medium text-fg">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-amb shadow-[0_0_10px_rgb(var(--amb))]" />
      <span className="shrink-0">{SAMPLE_ALT}</span>
      <span aria-hidden className="shrink-0 text-fg-muted">·</span>
      <span className="truncate text-fg-soft">{prompt}</span>
    </div>
  );
}

function Thumbnails({
  items,
  selected,
  onSelect,
  className,
}: {
  items: ShowcaseItem[];
  selected: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("lg:top-[calc(var(--screen-top)+var(--screen-h)+44px)]", className)}>
      <div
        role="radiogroup"
        aria-label="换一张示例作品"
        className="flex items-end gap-3 overflow-x-auto pb-1 scrollbar-hidden"
      >
        {items.map((entry, index) => {
          const active = index === selected;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`换成示例：${entry.prompt}`}
              onClick={() => onSelect(index)}
              className={cn(
                "relative shrink-0 overflow-hidden rounded-[10px] transition-[width,height,opacity,box-shadow] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amb",
                active
                  ? "h-[118px] w-[88px] opacity-100 shadow-[0_0_0_2px_rgb(255_255_255/0.9),0_0_40px_-6px_rgb(var(--amb)/0.8)]"
                  : "h-[96px] w-[72px] opacity-60 shadow-[0_0_0_1px_rgb(255_255_255/0.1)] hover:opacity-100",
              )}
            >
              {/* biome-ignore lint/performance/noImgElement: static export */}
              <img
                src={entry.src}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[13px] text-fg-muted">点一张，整个页面换成它的光</p>
    </div>
  );
}
