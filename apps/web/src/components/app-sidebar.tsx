"use client";

import { NavigationMenu } from "@base-ui/react/navigation-menu";
import {
  BlocksIcon,
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
import { WorksMenuItem, WorksMenuPortal } from "./works/works-menu";
import { isWorksPath } from "./works/works-nav";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Top bar order. 作品 (第 56 条) is a menu: 最近生成 (/history) and 画布项目
 * (/projects), see components/works.
 */
const NAV_ITEMS: (NavItem | "works")[] = [
  { href: "/home", label: "首页", icon: HouseIcon },
  { href: "/studio", label: "生图", icon: SparklesIcon },
  "works",
  { href: "/brand-kit", label: "品牌套件", icon: SwatchBookIcon },
  { href: "/skills", label: "技能", icon: BlocksIcon },
  { href: "/settings", label: "设置", icon: Settings2Icon },
];

/** Bottom bar on phones: the four places used most; 作品 opens 最近生成. */
const MOBILE_ITEMS: NavItem[] = [
  { href: "/home", label: "首页", icon: HouseIcon },
  { href: "/studio", label: "生图", icon: SparklesIcon },
  { href: "/history", label: "作品", icon: ImagesIcon },
  { href: "/settings", label: "设置", icon: Settings2Icon },
];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    // 作品 on phones stands for both of its pages.
    (href === "/history" && isWorksPath(pathname));
}

/**
 * Workspace navigation. Desktop and tablet: a top bar over the room
 * (wordmark, slanted section tabs with the current one inked, balance,
 * theme and account). Once the page scrolls under it, the page dissolves
 * into it through a progressive blur instead of a hard frosted strip. Phones: the same top bar without the tabs, plus a bottom tab bar.
 *
 * (File name kept from the earlier side-rail layout so imports stay put.)
 */
export function AppSidebar() {
  const isActive = useIsActive();
  const pathname = usePathname();
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
        <div className="relative mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-4 sm:px-8 md:h-[72px] lg:gap-8 lg:px-[clamp(20px,2.4vw,40px)]">
          <Link href="/home" aria-label={`${BRAND.name} 首页`} className="shrink-0 rounded-md">
            <BrandLockup tagClassName="md:max-xl:hidden" />
          </Link>

          <NavigationMenu.Root aria-label="主导航" delay={80} closeDelay={160} className="hidden min-w-0 md:block">
            <NavigationMenu.List className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                if (item === "works") return <WorksMenuItem key="works" active={isWorksPath(pathname)} />;
                const active = isActive(item.href);
                return (
                  <NavigationMenu.Item key={item.href}>
                    <NavigationMenu.Link
                      render={<Link href={item.href} />}
                      closeOnClick
                      active={active}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "sk inline-flex h-[34px] items-center rounded-[10px] px-3 text-[13.5px] font-semibold whitespace-nowrap transition-[background-color,color,translate] outline-none active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc lg:px-3.5",
                        active ? "bg-fg text-ground" : "text-fg-soft hover:bg-tint/[0.06] hover:text-fg",
                      )}
                    >
                      <span className="sk-in">{item.label}</span>
                    </NavigationMenu.Link>
                  </NavigationMenu.Item>
                );
              })}
            </NavigationMenu.List>
            <WorksMenuPortal />
          </NavigationMenu.Root>

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
