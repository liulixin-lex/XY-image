"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { AmbientField, useAmbientImage } from "../ambient/ambient-provider";
import { BrandLockup } from "../brand/brand-mark";
import { PosterStage } from "../landing/poster-stage";
import { SAMPLE_ALT, SHOWCASE_ITEMS } from "../landing/showcase";
import { ThemeToggle } from "../theme-toggle";

// The landing page opens on the same sample, so the room keeps its colour
// when a visitor clicks 登录 from the homepage.
const SAMPLE = SHOWCASE_ITEMS[0]!;
const FAR = [SHOWCASE_ITEMS[5]!, SHOWCASE_ITEMS[8]!] as const;

/**
 * Auth layout: the same poster room as the homepage. The form hangs on the
 * wall in a glass panel at left; on desktop the sample stands on the floor
 * at right. Below lg the form is the whole page.
 */
export function LoginView({ children }: { children: ReactNode }) {
  useAmbientImage(SAMPLE.large, { amb: SAMPLE.amb, amb2: SAMPLE.amb2 });

  return (
    <div className="relative isolate min-h-[100dvh] overflow-hidden bg-ground">
      <AmbientField horizon={80} />

      <header className="relative z-20 mx-auto flex h-[72px] max-w-[1600px] items-center justify-between px-5 sm:h-20 sm:px-10 lg:px-[clamp(24px,3.6vw,64px)]">
        <Link href="/" aria-label="返回首页" className="rounded-md">
          <BrandLockup />
        </Link>
        <ThemeToggle />
      </header>

      <div className="relative z-10 mx-auto grid min-h-[calc(100dvh-80px)] max-w-[1600px] grid-cols-1 px-5 pb-10 sm:px-10 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] lg:gap-16 lg:px-[clamp(24px,3.6vw,64px)] lg:pb-0">
        <div className="flex items-center py-6 lg:pb-[14dvh]">
          <div className="glass mx-auto w-full max-w-[460px] rounded-[24px] px-6 py-8 sm:px-9 sm:py-10 lg:mx-0">
            {children}
          </div>
        </div>

        <div aria-hidden className="relative hidden lg:block">
          {/* Stands on the horizon at 80% of the viewport. */}
          <div className="absolute bottom-[calc(20dvh-6px)] left-[4%] aspect-[740/640] h-[min(64dvh,620px)]">
            <PosterStage
              image={{
                src: SAMPLE.large,
                srcSet: `${SAMPLE.src} 540w, ${SAMPLE.large} 900w`,
                alt: SAMPLE_ALT,
                focus: SAMPLE.focus,
              }}
              far={[
                { src: FAR[0].src, alt: "", focus: FAR[0].focus },
                { src: FAR[1].src, alt: "", focus: FAR[1].focus },
              ]}
              eager
              sizes="40vw"
              className="h-full w-full"
            >
              <span className="absolute top-[5.3%] left-[64%] z-[2] -rotate-6 rounded-[10px] bg-acc px-3.5 py-2 font-display text-[17px] leading-none text-acc-ink shadow-acc">
                {SAMPLE_ALT}
              </span>
            </PosterStage>
          </div>
        </div>
      </div>
    </div>
  );
}
