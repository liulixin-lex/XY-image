"use client";

import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/lib/auth-context";
import { BRAND } from "@/lib/brand";

import { BrandLockup } from "../brand/brand-mark";
import { ImageWall } from "./image-wall";
import { SAMPLE_ALT, SHOWCASE_ITEMS } from "./showcase";

/**
 * The closing poster: the call to action on ink, and on its right a wall of
 * every sample tilted back in 3D, its columns drifting (ImageWall; the user
 * picked it from recorded previews, 第 62 条). Ink fades over the wall's
 * left edge so the words stay clear; small screens show only the words.
 */
export function Closing({
  registerUrl,
  mainSiteUrl,
  onWrite,
}: {
  registerUrl: string | null;
  mainSiteUrl: string | null;
  /** Scroll back up to the prompt box. */
  onWrite: () => void;
}) {
  const { user } = useAuth();
  return (
    <>
      <section aria-labelledby="closing-title" className="relative z-10 pt-8 pb-24 lg:pt-12 lg:pb-32">
        <div className="mx-auto max-w-[1600px] px-5 sm:px-8 lg:px-[clamp(24px,3.6vw,64px)]">
          {/* An inked poster: graphite in light, pale in dark; the coral action reads on both. */}
          <div className="relative grid overflow-hidden rounded-[24px] bg-fg text-ground shadow-[0_40px_80px_-40px_var(--shadow-2)] lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]"
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
            <ImageWall items={SHOWCASE_ITEMS} className="hidden lg:block" />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(90deg,var(--fg)_28%,color-mix(in_srgb,var(--fg)_55%,transparent)_52%,transparent_80%)] lg:block"
            />
            <div aria-hidden className="relative hidden min-h-[460px] lg:block">
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
