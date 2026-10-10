"use client";

import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/lib/auth-context";
import { BRAND } from "@/lib/brand";

import { BrandLockup } from "../brand/brand-mark";
import { SAMPLE_ALT, type ShowcaseItem } from "./showcase";

export function Closing({
  registerUrl,
  mainSiteUrl,
  sample,
  onWrite,
}: {
  registerUrl: string | null;
  mainSiteUrl: string | null;
  /** The sample on show in the hero; the closing poster repeats it. */
  sample: ShowcaseItem;
  /** Scroll back up to the prompt box. */
  onWrite: () => void;
}) {
  const { user } = useAuth();
  return (
    <>
      <section aria-labelledby="closing-title" className="relative z-10 pt-8 pb-24 lg:pt-12 lg:pb-32">
        <div className="mx-auto max-w-[1600px] px-5 sm:px-8 lg:px-[clamp(24px,3.6vw,64px)]">
          {/* An inked poster: graphite in light, pale in dark; the coral action reads on both. */}
          <div className="relative grid overflow-hidden rounded-[24px] bg-fg text-ground shadow-[0_40px_80px_-40px_var(--shadow-2)] lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
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
            {/* The sample on show, standing in the poster and cut by its edge. */}
            <div aria-hidden className="relative hidden min-h-[420px] lg:block">
              <div className="absolute top-[14%] left-[4%] h-[100%] w-[78%]">
                <div className="sk h-full w-full translate-x-[9%] translate-y-[5%] rounded-[24px] bg-[rgb(var(--amb)/0.75)]" />
              </div>
              <div className="sk-frame absolute top-[14%] left-[4%] h-[100%] w-[78%] rounded-[24px] shadow-[0_30px_60px_-30px_rgb(0_0_0/0.6)]">
                {/* biome-ignore lint/performance/noImgElement: static export */}
                <img
                  src={sample.src}
                  alt={`${SAMPLE_ALT}：${sample.prompt}`}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                  style={{ objectPosition: sample.focus }}
                />
              </div>
              <span className="absolute top-[10%] left-[54%] -rotate-6 rounded-[10px] bg-acc px-3.5 py-2 font-display text-[17px] leading-none text-acc-ink shadow-acc">
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
