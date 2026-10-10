import Link from "next/link";

import { AmbientField } from "@/components/ambient/ambient-provider";
import { BrandLockup } from "@/components/brand/brand-mark";
import { buttonVariants } from "@/components/ui/button-variants";

export default function NotFound() {
  return (
    <div className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden bg-ground px-5 py-6 sm:px-12">
      <AmbientField horizon={78} className="-z-10" />
      <Link href="/" aria-label="返回首页" className="self-start rounded-md">
        <BrandLockup />
      </Link>
      <div className="flex flex-1 flex-col items-start justify-center gap-5">
        <span aria-hidden className="numeral text-[clamp(120px,18vw,240px)] text-fg/90">
          404
        </span>
        <h1 className="font-display text-[clamp(40px,5vw,72px)] leading-[1.02] font-normal text-fg">
          这个页面<em className="text-acc not-italic">不存在</em>
        </h1>
        <p className="text-[16px] text-fg-soft">链接可能已失效，或页面已经移走。</p>
        <Link href="/home" className={buttonVariants({ variant: "accent", size: "poster", slant: true, className: "mt-2" })}>
          <span className="sk-in">回到工作台</span>
        </Link>
      </div>
    </div>
  );
}
