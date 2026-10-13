"use client";

/**
 * Numbered pages (生成记录, 第 58 条): 上一页, the first and last page, the
 * pages around the current one with gaps between, 下一页. Pages are 1-based.
 */
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type PageItem = number | "gap";

/**
 * At most 7 slots: 1 … 4 5 6 … 20. Short lists show every page; a gap of
 * one page shows that page instead of 「…」.
 */
export function pageItems(current: number, pages: number): PageItem[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const page = Math.min(Math.max(current, 1), pages);
  const start = Math.max(2, Math.min(page - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(page + 1, 5));
  const items: PageItem[] = [1];
  if (start > 2) items.push(start === 3 ? 2 : "gap");
  for (let n = start; n <= end; n++) items.push(n);
  if (end < pages - 1) items.push(end === pages - 2 ? pages - 1 : "gap");
  items.push(pages);
  return items;
}

export function Pager({
  page,
  pages,
  onPage,
  disabled,
  className,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (pages <= 1) return null;
  const cell =
    "flex h-9 min-w-9 items-center justify-center rounded-[10px] px-2 text-[13px] font-semibold tabular transition-[background-color,color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:pointer-events-none disabled:opacity-40";
  return (
    <nav aria-label="分页" className={cn("flex flex-wrap items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={disabled || page <= 1}
        className={cn(cell, "gap-1 text-fg-soft hover:bg-tint/[0.06] hover:text-fg [&_svg]:size-4")}
      >
        <ChevronLeftIcon strokeWidth={2} />
        <span className="max-sm:sr-only">上一页</span>
      </button>
      {pageItems(page, pages).map((item, index) =>
        item === "gap" ? (
          <span key={`gap-${index}`} aria-hidden className="w-6 text-center text-fg-muted">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onPage(item)}
            disabled={disabled}
            aria-current={item === page ? "page" : undefined}
            aria-label={`第 ${item} 页`}
            className={cn(
              cell,
              item === page
                ? "bg-panel text-fg shadow-[0_1px_2px_var(--shadow),0_4px_12px_-6px_var(--shadow-2)]"
                : "text-fg-soft hover:bg-tint/[0.06] hover:text-fg",
            )}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={disabled || page >= pages}
        className={cn(cell, "gap-1 text-fg-soft hover:bg-tint/[0.06] hover:text-fg [&_svg]:size-4")}
      >
        <span className="max-sm:sr-only">下一页</span>
        <ChevronRightIcon strokeWidth={2} />
      </button>
    </nav>
  );
}
