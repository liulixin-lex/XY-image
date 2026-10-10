"use client";

import type { BrandKitSummary } from "@loomic/shared";
import { Plus, Trash2 } from "lucide-react";

import { cn } from "../../lib/utils";

interface BrandKitSidebarProps {
  kits: BrandKitSummary[];
  selectedKitId: string | null;
  onSelectKit: (kitId: string) => void;
  onCreateKit: () => void;
  onDeleteKit: (kitId: string) => void;
}

export function BrandKitSidebar({
  kits,
  selectedKitId,
  onSelectKit,
  onCreateKit,
  onDeleteKit,
}: BrandKitSidebarProps) {
  return (
    <aside className="glass flex w-full shrink-0 flex-col overflow-hidden rounded-[20px] md:w-[260px]">
      {/* List title + create (the page header names the feature) */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <h2 className="poster-label text-[16px] leading-none text-fg">我的套件</h2>
        <button
          type="button"
          onClick={onCreateKit}
          className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-[10px] bg-tint/[0.06] px-3 text-[13px] font-semibold text-fg-soft transition-colors outline-none hover:bg-tint/[0.1] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc active:translate-y-px sm:min-h-0 sm:h-8"
        >
          <Plus aria-hidden className="size-3.5" strokeWidth={2.2} />
          新建套件
        </button>
      </div>

      {/* Kit list -- horizontal scroll on mobile, vertical on desktop */}
      <div className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-1 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:pb-4">
        {kits.map((kit) => {
          const isSelected = kit.id === selectedKitId;
          // Select and delete are sibling buttons; nesting them is invalid HTML.
          return (
            <div
              key={kit.id}
              className={cn(
                "group flex min-h-[44px] w-auto shrink-0 items-center gap-1 rounded-[12px] pr-1 transition-colors md:min-h-0 md:w-full md:shrink",
                isSelected ? "bg-panel shadow-card" : "hover:bg-tint/[0.06]",
              )}
            >
              <button
                type="button"
                onClick={() => onSelectKit(kit.id)}
                aria-current={isSelected ? "true" : undefined}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acc"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-[9px] font-display text-[15px] leading-none",
                    isSelected ? "bg-acc text-acc-ink" : "bg-tint/[0.07] text-fg-soft",
                  )}
                >
                  {Array.from(kit.name)[0]?.toUpperCase() ?? "·"}
                </span>
                <span className="truncate text-sm font-medium text-fg">{kit.name}</span>
                {kit.is_default && (
                  <span className="shrink-0 rounded-[6px] bg-acc-soft px-1.5 py-0.5 text-[11px] font-semibold text-acc-text">
                    默认
                  </span>
                )}
              </button>

              {/* Hover delete -- hidden on mobile; the editor menu covers it there */}
              <button
                type="button"
                onClick={() => onDeleteKit(kit.id)}
                className="hidden shrink-0 cursor-pointer rounded-[8px] p-1.5 text-fg-muted opacity-0 transition-all outline-none hover:bg-alert-wash hover:text-alert focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-acc group-hover:opacity-100 md:block"
                aria-label={`删除套件 ${kit.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
