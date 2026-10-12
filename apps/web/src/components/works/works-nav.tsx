"use client";

/**
 * 作品 (第 56 条): what the user has made lives in two places, reached from
 * the 作品 menu in the top bar and switched between with these tabs at the
 * top of each page. 最近生成 lists every picture (studio, canvas nodes and
 * the design assistant); 画布项目 lists every canvas.
 */
import { FolderOpenIcon, ImagesIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type WorksSection = {
  href: "/history" | "/projects";
  label: string;
  hint: string;
  icon: LucideIcon;
};

export const WORKS_SECTIONS: readonly WorksSection[] = [
  { href: "/history", label: "最近生成", hint: "生成过的每一张图，按日期", icon: ImagesIcon },
  { href: "/projects", label: "画布项目", hint: "每一张画布，最近打开的在前", icon: FolderOpenIcon },
];

export function isWorksPath(pathname: string) {
  return WORKS_SECTIONS.some((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
}

/** The second level under 作品: two slanted tabs, the open page inked. */
export function WorksTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="作品" className={cn("flex items-center gap-1.5", className)}>
      <span className="mr-1.5 data-label text-fg-muted">作品 /</span>
      {WORKS_SECTIONS.map((section) => {
        const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
        const Icon = section.icon;
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "sk inline-flex h-9 items-center rounded-[10px] px-3.5 text-[13.5px] font-semibold whitespace-nowrap transition-[background-color,color,translate] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:translate-y-px",
              active ? "bg-fg text-ground" : "bg-tint/[0.055] text-fg-soft hover:bg-tint/[0.09] hover:text-fg",
            )}
          >
            <span className="sk-in gap-1.5">
              <Icon className="size-4" strokeWidth={1.9} />
              {section.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
