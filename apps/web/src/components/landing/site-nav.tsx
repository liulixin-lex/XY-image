"use client";

import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

import { BrandLockup } from "../brand/brand-mark";
import { ThemeToggle } from "../theme-toggle";

const LINKS = [
  { href: "#top", label: "首页" },
  { href: "#gallery", label: "作品" },
  { href: "#models", label: "模型" },
  { href: "#billing", label: "计费说明" },
];

/**
 * Public nav over the room: wordmark, slanted section tabs (the section in
 * view is inked), the theme switch and the way in (登录 / 进入工作台).
 * Fixed and clear over the hero; a frosted strip once the page scrolls.
 */
export function SiteNav({ registerUrl }: { registerUrl: string | null }) {
  const { user, loading } = useAuth();
  const current = useSectionInView(LINKS.map((link) => link.href.slice(1)));
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header
      data-scrolled={scrolled || undefined}
      className="fixed inset-x-0 top-0 z-30 transition-[background-color,box-shadow,backdrop-filter] duration-300 data-[scrolled]:bg-ground/78 data-[scrolled]:shadow-[0_1px_0_var(--line)] data-[scrolled]:backdrop-blur-xl"
    >
      <nav
        aria-label="主导航"
        className="mx-auto flex h-[72px] max-w-[1600px] sm:h-20 items-center gap-4 px-5 sm:px-8 lg:gap-10 lg:px-[clamp(24px,3.6vw,64px)]"
      >
        <Link href="/" aria-label={`${BRAND.name} 首页`} className="shrink-0 rounded-md">
          <BrandLockup tagClassName="max-sm:hidden" />
        </Link>

        <div className="hidden items-center gap-1.5 md:flex">
          {LINKS.map((link) => {
            const active = current === link.href.slice(1);
            return (
              <a
                key={link.href}
                href={link.href}
                aria-current={active ? "location" : undefined}
                className={cn(
                  "sk inline-flex h-[34px] items-center rounded-[10px] px-3.5 text-[14px] font-semibold transition-colors",
                  active ? "bg-fg text-ground" : "text-fg-soft hover:bg-tint/[0.06] hover:text-fg",
                )}
              >
                <span className="sk-in">{link.label}</span>
              </a>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-4">
          {registerUrl && !user ? (
            <a
              href={registerUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1 rounded-md py-2 text-[14px] font-medium text-fg-soft transition-colors hover:text-fg sm:inline-flex"
            >
              注册主站账号
              <ArrowUpRightIcon className="size-3.5" strokeWidth={1.75} />
            </a>
          ) : null}
          <ThemeToggle />
          {loading ? (
            <span className="h-10 w-[76px]" aria-hidden />
          ) : (
            <Link
              href={user ? "/studio" : "/login"}
              className={cn(
                "sk inline-flex h-10 items-center rounded-[11px] px-5 font-display text-[17px] tracking-[0.02em] transition-[background-color,scale] active:scale-[0.97]",
                user
                  ? "bg-acc text-acc-ink shadow-acc hover:bg-acc-hover"
                  : "bg-fg text-ground shadow-[0_10px_22px_-12px_var(--shadow-2)] hover:bg-fg/88",
              )}
            >
              <span className="sk-in">{user ? "进入工作台" : "登录"}</span>
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}

/** Id of the landing section nearest the top of the viewport. */
function useSectionInView(ids: string[]) {
  const [current, setCurrent] = useState(ids[0] ?? "");
  const key = ids.join(",");
  useEffect(() => {
    const sections = key
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.intersectionRatio);
        // The first section (in page order) that is meaningfully on screen.
        const next = sections.find((el) => (visible.get(el.id) ?? 0) > 0.25);
        if (next) setCurrent(next.id);
      },
      { threshold: [0, 0.25, 0.5] },
    );
    for (const el of sections) observer.observe(el);
    return () => observer.disconnect();
  }, [key]);
  return current;
}
