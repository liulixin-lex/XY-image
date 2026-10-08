"use client";

import {
  BlocksIcon,
  FolderOpenIcon,
  HouseIcon,
  type LucideIcon,
  Settings2Icon,
  SparklesIcon,
  SwatchBookIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

import { AccountChip } from "./account/account-chip";
import { BrandLockup } from "./brand/brand-mark";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/home", label: "首页", icon: HouseIcon },
  { href: "/studio", label: "生图", icon: SparklesIcon },
  { href: "/projects", label: "画布项目", icon: FolderOpenIcon },
  { href: "/brand-kit", label: "品牌套件", icon: SwatchBookIcon },
  { href: "/skills", label: "技能", icon: BlocksIcon },
  { href: "/settings", label: "设置", icon: Settings2Icon },
];

/** Bottom bar on phones: the four places used most. */
const MOBILE_ITEMS = [NAV_ITEMS[0]!, NAV_ITEMS[1]!, NAV_ITEMS[2]!, NAV_ITEMS[5]!];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Workspace navigation. Desktop and tablet: a top bar floating over the
 * room (wordmark, a glass pill of sections, balance and account). It turns
 * into a glass strip once the page scrolls under it. Phones: the same top
 * bar without the pill, plus a bottom tab bar.
 *
 * (File name kept from the earlier side-rail layout so imports stay put.)
 */
export function AppSidebar() {
  const isActive = useIsActive();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <>
      <header
        data-scrolled={scrolled || undefined}
        className="sticky top-0 z-40 border-b border-transparent transition-[background-color,border-color,backdrop-filter] duration-300 data-[scrolled]:border-line data-[scrolled]:bg-ground/70 data-[scrolled]:backdrop-blur-xl"
      >
        <div className="mx-auto flex h-[68px] max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-8 md:h-[84px] lg:px-12">
          <Link href="/home" aria-label={`${BRAND.name} 首页`} className="shrink-0 rounded-md">
            {/* The nav is centred absolutely; at md the tag would run into it. */}
            <BrandLockup tagClassName="md:max-lg:hidden" />
          </Link>

          <nav
            aria-label="主导航"
            className="glass absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-[14px] p-[5px] md:flex"
          >
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-[10px] px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors lg:px-4",
                    active
                      ? "bg-white/[0.1] text-fg"
                      : "text-fg-soft hover:bg-white/[0.06] hover:text-fg",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <AccountChip />
        </div>
      </header>

      <nav
        aria-label="主导航"
        className="glass-strong fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 flex items-stretch justify-around rounded-[18px] p-1 md:hidden"
      >
        {MOBILE_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-[14px] text-[11px] transition-colors",
                active ? "bg-white/[0.1] font-semibold text-fg" : "text-fg-muted",
              )}
            >
              <Icon className={cn("size-5", active && "text-amb")} strokeWidth={active ? 2 : 1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
