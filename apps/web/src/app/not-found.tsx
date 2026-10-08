import Link from "next/link";

import { BrandLockup } from "@/components/brand/brand-mark";

export default function NotFound() {
  return (
    <div className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden bg-ground px-5 py-6 sm:px-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_75%_40%,rgb(var(--amb)/0.22),transparent_70%),radial-gradient(40%_50%_at_20%_80%,rgb(var(--amb-2)/0.16),transparent_70%)]"
      />
      <Link href="/" aria-label="返回首页" className="self-start rounded-md">
        <BrandLockup />
      </Link>
      <div className="flex flex-1 flex-col items-start justify-center gap-5">
        <span className="font-mono text-[13px] text-fg-muted">404</span>
        <h1 className="font-display text-[clamp(44px,6vw,84px)] leading-[1.02] font-normal text-fg">
          这个页面不存在
        </h1>
        <p className="text-[16px] text-fg-soft">链接可能已失效，或页面已经移走。</p>
        <Link
          href="/home"
          className="mt-2 inline-flex h-11 items-center rounded-xl bg-fg px-5 text-[15px] font-semibold text-ground glow-amb transition-colors hover:bg-white"
        >
          回到工作台
        </Link>
      </div>
    </div>
  );
}
