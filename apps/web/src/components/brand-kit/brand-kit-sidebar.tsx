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
      {/* Header */}
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-sm font-semibold text-fg">品牌套件</h1>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
          标志、颜色、字体和品牌说明，助手出图时会参考。
        </p>
      </div>

      {/* Create button */}
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onCreateKit}
          className="flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2 text-sm text-fg-soft transition-colors hover:border-white/30 hover:text-fg sm:min-h-0"
        >
          <Plus className="h-4 w-4" />
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
                "group flex min-h-[44px] w-auto shrink-0 items-center gap-1 rounded-md pr-1 transition-colors md:min-h-0 md:w-full md:shrink",
                isSelected ? "bg-panel shadow-subtle" : "hover:bg-white/[0.06]",
              )}
            >
              <button
                type="button"
                onClick={() => onSelectKit(kit.id)}
                aria-current={isSelected ? "true" : undefined}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-frame border border-line bg-ground text-xs font-medium text-fg-soft">
                  {Array.from(kit.name)[0]?.toUpperCase() ?? "·"}
                </span>
                <span className="truncate text-sm font-medium text-fg">{kit.name}</span>
                {kit.is_default && (
                  <span className="shrink-0 rounded-frame border border-line px-1.5 py-0.5 text-[11px] font-medium text-fg-soft">
                    默认
                  </span>
                )}
              </button>

              {/* Hover delete -- hidden on mobile; the editor menu covers it there */}
              <button
                type="button"
                onClick={() => onDeleteKit(kit.id)}
                className="hidden shrink-0 cursor-pointer rounded-md p-1.5 text-fg-muted opacity-0 transition-all outline-none hover:bg-alert-wash hover:text-alert focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 md:block"
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
