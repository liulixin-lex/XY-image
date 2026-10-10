"use client";

import { forwardRef } from "react";

import { type AmbientPreset, AmbientWash } from "@/components/ambient/ambient-provider";
import type { AspectRatio, ImageResolution } from "@/lib/image-model-meta";
import { cn } from "@/lib/utils";

import { PosterStage, type StageImage } from "./poster-stage";
import { PromptBox, type PromptBoxHandle } from "./prompt-box";
import { SampleStrip } from "./sample-strip";
import { SAMPLE_ALT, type ShowcaseItem } from "./showcase";

/**
 * First viewport: the poster room. The headline and the working prompt box
 * hang on the wall at the left; the chosen sample stands on the floor at the
 * right as a slanted panel. Below the horizon, on the floor: what signing in
 * means (three plain facts) and the strip of samples that re-colour the room.
 *
 * Layout is two grid rows (wall, floor) so the horizon is a real boundary:
 * the panel stands on it at any desktop height. Below lg everything stacks.
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
    resolution: ImageResolution;
    onResolutionChange: (resolution: ImageResolution) => void;
  }
>(function Hero(
  { items, selected, onSelect, prompt, onPromptChange, ratio, onRatioChange, resolution, onResolutionChange },
  ref,
) {
  const current = items[selected] ?? items[0]!;
  const toStage = (entry: ShowcaseItem): StageImage => ({
    src: entry.large,
    srcSet: `${entry.src} 540w, ${entry.large} 900w`,
    alt: `${SAMPLE_ALT}：${entry.prompt}`,
    focus: entry.focus,
  });
  const at = (offset: number) => items[(selected + offset) % items.length] ?? current;
  const far: [StageImage, StageImage] = [
    { ...toStage(at(5)), src: at(5).src },
    { ...toStage(at(8)), src: at(8).src },
  ];

  const stage = (
    <PosterStage image={toStage(current)} far={far} eager className="h-full w-full">
      <span className="absolute top-[5.3%] left-[64%] z-[2] -rotate-6 rounded-[10px] bg-acc px-3.5 py-2 font-display text-[17px] leading-none text-acc-ink shadow-acc">
        {SAMPLE_ALT}
      </span>
      <figure className="glass-float absolute top-[84%] left-[38%] z-[2] m-0 w-[min(46%,330px)] rotate-[1.5deg] rounded-[16px] px-4 py-3">
        <figcaption>
          <span className="data-label block text-fg-muted tabular">
            {current.ratio} · 2K
          </span>
          <span className="mt-1 line-clamp-2 block text-[14px] leading-[1.55] font-semibold text-fg">
            {current.prompt}
          </span>
        </figcaption>
      </figure>
    </PosterStage>
  );

  return (
    <section
      id="top"
      aria-label="开始生成"
      className="relative isolate overflow-hidden lg:grid lg:min-h-[max(100dvh,800px)] lg:grid-rows-[minmax(0,1fr)_auto]"
    >
      {/* Wall */}
      <div className="relative z-[1] mx-auto grid w-full max-w-[1600px] grid-cols-1 px-5 pt-[96px] sm:px-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-x-6 lg:px-[clamp(24px,3.6vw,64px)] lg:pt-[clamp(88px,11dvh,112px)]">
        <div className="relative z-[3] flex flex-col pb-10 lg:pb-[clamp(24px,4dvh,44px)]">
          <h1 className="font-display leading-none font-normal text-fg">
            <span className="block text-[clamp(88px,min(14vw,19.5dvh),212px)] tracking-[-0.01em]">一句话</span>
            <span className="mt-[0.18em] block text-[clamp(44px,min(6.5vw,9.2dvh),96px)]">
              生成你<em className="text-acc not-italic">想要的图</em>
            </span>
          </h1>
          <p className="mt-6 max-w-[34em] text-[16px] leading-[1.8] text-fg-soft sm:text-[17px] lg:mt-[clamp(16px,3dvh,28px)]">
            主站账号直接登录。每张图都带请求 ID，在主站的用量记录里查得到。
          </p>
          <PromptBox
            ref={ref}
            value={prompt}
            onChange={onPromptChange}
            ratio={ratio}
            onRatioChange={onRatioChange}
            resolution={resolution}
            onResolutionChange={onResolutionChange}
            className="mt-7 w-full max-w-[640px] lg:mt-[clamp(18px,3.4dvh,36px)]"
          />
        </div>

        {/* Desktop: the stage stands on the horizon (bottom of this row). */}
        <div className="relative hidden min-h-0 lg:block">
          <div className="absolute right-[-6%] bottom-0 aspect-[740/640] h-[min(100%,680px)]">{stage}</div>
        </div>
        {/* Mobile and tablet: the stage below the prompt box. */}
        <div className="relative mx-auto mb-16 aspect-[740/640] w-full max-w-[640px] lg:hidden">{stage}</div>
      </div>

      {/* Floor */}
      <div className="relative">
        <Floor />
        <div className="relative z-[1] mx-auto grid max-w-[1600px] grid-cols-1 gap-10 px-5 pt-8 pb-14 sm:px-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-x-6 lg:px-[clamp(24px,3.6vw,64px)] lg:pt-[clamp(28px,5dvh,52px)] lg:pb-[clamp(24px,4dvh,44px)]">
          <Facts className="order-2 lg:order-1" />
          <Strip
            items={items}
            selected={selected}
            onSelect={onSelect}
            className="order-1 lg:order-2"
          />
        </div>
      </div>
    </section>
  );
});

// The picture's colour spilling onto the floor; cross-fades with the room.
const paintFloorSpill = ({ amb }: AmbientPreset) =>
  `radial-gradient(36% 60% at 72% 0%, rgb(${amb} / calc(var(--haze) * 0.6)), transparent 70%)`;

/**
 * The floor: a slightly deeper tone below a soft horizon, faint lines
 * converging under the picture, and the picture's colour spilling onto it.
 * Fades back into the wall at the bottom so the next section sits on it.
 */
function Floor() {
  const lines = [];
  const vanish = 1050;
  for (let i = -10; i <= 10; i += 1) {
    lines.push(<line key={i} x1={vanish + i * 26} y1="0" x2={vanish + i * 230} y2="258" />);
  }
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(var(--floor),var(--floor-2)_55%,transparent)]" />
      <AmbientWash paint={paintFloorSpill} />
      <svg
        viewBox="0 0 1440 258"
        preserveAspectRatio="xMidYMin slice"
        className="absolute inset-x-0 top-0 hidden h-full w-full lg:block"
        fill="none"
        stroke="var(--line)"
        strokeWidth="1"
      >
        {lines}
        <line x1="0" y1="70" x2="1440" y2="70" opacity="0.6" />
        <line x1="0" y1="160" x2="1440" y2="160" opacity="0.45" />
      </svg>
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--line-strong)_30%,var(--line-strong)_80%,transparent)]" />
    </div>
  );
}

const FACTS = [
  { label: "个账号", note: "主站邮箱和密码登录" },
  { label: "份余额", note: "和主站共用" },
  { label: "次请求", note: "只发一次，不自动重发" },
];

/** What signing in means, said on the floor in poster numerals. */
function Facts({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-10 gap-y-5 lg:self-end", className)}>
      {FACTS.map((fact) => (
        <li key={fact.label} className="flex items-end gap-2.5">
          <span aria-hidden className="numeral text-[clamp(52px,6dvh,70px)] text-fg/88">
            1
          </span>
          <span className="pb-0.5">
            <span className="block text-[15px] leading-tight font-semibold text-fg">
              <span className="sr-only">1 </span>
              {fact.label}
            </span>
            <span className="mt-1 block text-[12.5px] text-fg-muted">{fact.note}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Sample strip on the floor with the poster-numeral counter. */
function Strip({
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
    <div className={cn("min-w-0", className)}>
      <div className="flex items-end gap-4">
        <SampleStrip items={items} selected={selected} onSelect={onSelect} />
        <p aria-live="polite" className="numeral ml-auto shrink-0 text-[clamp(44px,6dvh,60px)] text-fg max-sm:hidden">
          {String(selected + 1).padStart(2, "0")}
          <span className="text-[0.4em] text-fg-muted">/{items.length}</span>
        </p>
      </div>
      <p className="mt-3 text-[13px] text-fg-muted">点一张，海报和整个房间都换成它的颜色</p>
    </div>
  );
}
