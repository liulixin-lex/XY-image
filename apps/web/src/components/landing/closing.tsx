"use client";

import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/lib/auth-context";
import { BRAND } from "@/lib/brand";

import { BrandLockup } from "../brand/brand-mark";

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
        <div className="mx-auto max-w-[1600px] px-5 sm:px-8 lg:px-[clamp(24px,4.4vw,96px)]">
          <div className="glass relative overflow-hidden rounded-[28px] px-7 py-14 sm:px-12 lg:px-16 lg:py-20">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-1/2 right-[-10%] h-[160%] w-[60%] bg-[radial-gradient(closest-side,rgb(var(--amb)/0.35),transparent)] blur-2xl transition-[background] duration-700"
            />
            <div className="relative flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
              <h2 id="closing-title" className="font-display text-[clamp(44px,5.6vw,88px)] leading-[1.02] text-fg">
                写一句话，
                <br />
                先试一张
              </h2>
              <div className="flex flex-col items-start gap-5 lg:items-end">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={onWrite}
                    className="inline-flex h-12 items-center gap-2 rounded-xl bg-fg px-6 text-[15px] font-semibold text-ground glow-amb transition-[background-color,transform] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amb active:scale-[0.98]"
                  >
                    去写描述
                    <ArrowRightIcon className="size-4" strokeWidth={2} />
                  </button>
                  <Link
                    href={user ? "/studio" : "/login"}
                    className="inline-flex h-12 items-center rounded-xl border border-line-strong bg-white/[0.04] px-6 text-[15px] font-medium text-fg transition-colors hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amb"
                  >
                    {user ? "进入工作台" : "用主站账号登录"}
                  </Link>
                </div>
                {registerUrl && !user ? (
                  <a
                    href={registerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[14px] text-fg-soft underline decoration-line-strong underline-offset-4 transition-colors hover:text-fg hover:decoration-fg"
                  >
                    还没有主站账号？先去注册
                    <ArrowUpRightIcon className="size-3.5" />
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>
      <footer className="relative z-10 border-t border-line">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-5 py-8 text-sm text-fg-muted sm:px-8 md:flex-row md:items-center md:justify-between lg:px-[clamp(24px,4.4vw,96px)]">
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
