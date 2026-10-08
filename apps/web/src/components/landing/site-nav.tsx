"use client";

import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/lib/auth-context";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

import { BrandLockup } from "../brand/brand-mark";

const LINKS = [
  { href: "#gallery", label: "作品" },
  { href: "#models", label: "模型" },
  { href: "#billing", label: "计费说明" },
];

/**
 * Public nav floating over the room: wordmark, a glass pill of in-page
 * links, and the way in (登录 / 进入工作台 when already signed in).
 */
export function SiteNav({ registerUrl }: { registerUrl: string | null }) {
  const { user, loading } = useAuth();

  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <nav
        aria-label="主导航"
        className="mx-auto flex h-[88px] max-w-[1600px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-[clamp(24px,4.4vw,96px)]"
      >
        <Link href="/" aria-label={`${BRAND.name} 首页`} className="rounded-md">
          <BrandLockup />
        </Link>

        <div className="glass absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-[14px] p-[5px] md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-[10px] px-3.5 py-2 text-sm font-medium text-fg-soft transition-colors hover:bg-white/[0.08] hover:text-fg"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {registerUrl && !user ? (
            <a
              href={registerUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1 rounded-md px-2 py-2 text-sm font-medium text-fg-soft transition-colors hover:text-fg sm:inline-flex"
            >
              注册主站账号
              <ArrowUpRightIcon className="size-3.5" strokeWidth={1.75} />
            </a>
          ) : null}
          {loading ? (
            <span className="h-9 w-[72px]" aria-hidden />
          ) : (
            <Link
              href={user ? "/studio" : "/login"}
              className={cn(
                "inline-flex h-9 items-center rounded-[10px] border px-4 text-sm font-medium transition-colors",
                user
                  ? "border-transparent bg-fg text-ground glow-amb hover:bg-white"
                  : "border-line-strong bg-white/[0.04] text-fg backdrop-blur-md hover:bg-white/[0.1]",
              )}
            >
              {user ? "进入工作台" : "登录"}
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
