"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { AmbientField, useAmbientImage } from "../ambient/ambient-provider";
import { LightScreen } from "../ambient/light-screen";
import { BrandLockup } from "../brand/brand-mark";
import { SAMPLE_ALT, SHOWCASE_ITEMS } from "../landing/showcase";

// The landing page opens on the same sample, so the room keeps its light
// when a visitor clicks 登录 from the homepage.
const SAMPLE = SHOWCASE_ITEMS[0]!;

/**
 * Auth layout: the same lit room as the homepage. The form sits in a glass
 * panel at left; on desktop the sample hangs on a tilted screen at right.
 */
export function LoginView({ children }: { children: ReactNode }) {
  useAmbientImage(SAMPLE.large, { amb: SAMPLE.amb, amb2: SAMPLE.amb2 });

  return (
    <div className="relative isolate min-h-[100dvh] overflow-hidden bg-ground">
      <AmbientField />

      <div className="relative z-10 grid min-h-[100dvh] grid-cols-1 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="flex flex-col px-5 py-6 sm:px-10 lg:pl-[clamp(24px,4.4vw,96px)] lg:pr-0">
          <Link href="/" aria-label="返回首页" className="flex h-[52px] items-center self-start rounded-md">
            <BrandLockup />
          </Link>
          <div className="flex flex-1 items-center py-10">
            <div className="glass-strong mx-auto w-full max-w-[440px] rounded-[24px] px-6 py-8 sm:px-9 sm:py-10 lg:mx-0">
              {children}
            </div>
          </div>
        </div>

        <div aria-hidden className="relative hidden lg:block">
          <LightScreen
            image={{
              src: SAMPLE.large,
              srcSet: `${SAMPLE.src} 540w, ${SAMPLE.large} 900w`,
              alt: SAMPLE_ALT,
              focus: SAMPLE.focus,
            }}
            eager
            tilt={-20}
            sizes="50vw"
            className="absolute top-1/2 left-[10%] aspect-[1.393] w-[min(78%,1000px)] -translate-y-[56%]"
          />
        </div>
      </div>
    </div>
  );
}
