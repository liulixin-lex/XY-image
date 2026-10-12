"use client";

import {
  BlocksIcon,
  FolderOpenIcon,
  HouseIcon,
  ImagesIcon,
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

/**
 * Top bar order. 画布 (/projects) and 作品 (/history, every picture) are
 * plain links: a click goes straight to the page (第 57 条; the hover
 * panels of the first draft were dropped at the user's word).
 */
const NAV_ITEMS: NavItem[] = [
  { href: "/home", label: "首页", icon: HouseIcon },
  { href: "/studio", label: "生图", icon: SparklesIcon },
  { href: "/projects", label: "画布", icon: FolderOpenIcon },
  { href: "/history", label: "作品", icon: ImagesIcon },
  { href: "/brand-kit", label: "品牌套件", icon: SwatchBookIcon },
  { href: "/skills", label: "技能", icon: BlocksIcon },
  { href: "/settings", label: "设置", icon: Settings2Icon },
];

/** Bottom bar on phones: the five places used most. */
const MOBILE_ITEMS: NavItem[] = [
  { href: "/home", label: "首页", icon: HouseIcon },
  { href: "/studio", label: "生图", icon: SparklesIcon },
  { href: "/projects", label: "画布", icon: FolderOpenIcon },
  { href: "/history", label: "作品", icon: ImagesIcon },
  { href: "/settings", label: "设置", icon: Settings2Icon },
];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Workspace navigation. Desktop and tablet: a top bar over the room
 * (wordmark, slanted section tabs with the current one inked, balance,
 * theme and account). Once the page scrolls under it, the page dissolves
 * into it through a progressive blur instead of a hard frosted strip.
 * Phones: the same top bar without the tabs, plus a bottom tab bar.
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
      <header data-scrolled={scrolled || undefined} className="sticky top-0 z-40">
        {/* The page dissolves into the bar as it scrolls under it (globals.css). */}
        <div aria-hidden className="progressive-veil">
          <i />
          <i />
          <i />
        </div>
        <div className="relative mx-auto flex h-16 max-w-[1600px] items-center gap-4 gutter-x md:h-[72px] lg:gap-8">
          <Link href="/home" aria-label={`${BRAND.name} 首页`} className="shrink-0 rounded-md">
            <BrandLockup tagClassName="md:max-xl:hidden" />
          </Link>

          <nav aria-label="主导航" className="hidden min-w-0 items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "sk inline-flex h-[34px] items-center rounded-[10px] px-3 text-[13.5px] font-semibold whitespace-nowrap transition-[background-color,color,translate] outline-none active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc lg:px-3.5",
                    active ? "bg-fg text-ground" : "text-fg-soft hover:bg-tint/[0.06] hover:text-fg",
                  )}
                >
                  <span className="sk-in">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <AccountChip className="ml-auto" />
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
                active ? "bg-fg font-semibold text-ground" : "text-fg-muted",
              )}
            >
              <Icon className="size-5" strokeWidth={active ? 2 : 1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
