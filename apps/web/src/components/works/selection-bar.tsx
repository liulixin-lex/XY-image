"use client";

/**
 * The bar of batch actions while pictures are selected (作品, 第 58 条).
 * Floats over the bottom of the page (above the phone's bottom bar) in the
 * room's glass, so the grid stays in view and keeps scrolling under it.
 */
import { CheckCheckIcon, DownloadIcon, ImagePlusIcon, Trash2Icon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SelectionBar({
  count,
  total,
  allSelected,
  busy,
  onSelectAll,
  onDownload,
  onReference,
  onDelete,
  onClose,
}: {
  count: number;
  /** Pictures loaded on the page (全选 takes these). */
  total: number;
  allSelected: boolean;
  /** e.g. 「打包中 3/12」 while a download runs. */
  busy: string | null;
  onSelectAll: () => void;
  onDownload: () => void;
  /** Absent when no model can take a reference, or too many are selected. */
  onReference?: (() => void) | undefined;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="已选作品的操作"
      className="glass-float fixed inset-x-3 bottom-[calc(max(12px,env(safe-area-inset-bottom))+76px)] z-40 mx-auto flex max-w-[640px] items-center gap-1 rounded-[18px] p-1.5 pl-4 animate-in fade-in-0 slide-in-from-bottom-3 duration-200 motion-reduce:animate-none md:bottom-8"
    >
      <p aria-live="polite" className="mr-auto min-w-0 truncate text-[14px] font-semibold text-fg tabular">
        {busy ?? (count ? `已选 ${count} 张` : "点图片来选择")}
      </p>
      <BarButton onClick={onSelectAll} label={allSelected ? "全不选" : `全选 ${total} 张`}>
        <CheckCheckIcon />
      </BarButton>
      <BarButton onClick={onDownload} disabled={!count || Boolean(busy)} label="下载">
        <DownloadIcon />
      </BarButton>
      {onReference ? (
        <BarButton onClick={onReference} disabled={!count} label="作参考">
          <ImagePlusIcon />
        </BarButton>
      ) : null}
      <BarButton onClick={onDelete} disabled={!count} label="删除" tone="danger">
        <Trash2Icon />
      </BarButton>
      <button
        type="button"
        onClick={onClose}
        aria-label="退出选择"
        title="退出选择（Esc）"
        className="ml-1 flex size-9 shrink-0 items-center justify-center rounded-[12px] text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc [&_svg]:size-[18px]"
      >
        <XIcon strokeWidth={2} />
      </button>
    </div>
  );
}

function BarButton({
  children,
  label,
  onClick,
  disabled,
  tone,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-[12px] px-2.5 text-[13px] font-semibold transition-[background-color,color,opacity] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:pointer-events-none disabled:opacity-40 active:translate-y-px [&_svg]:size-4 sm:px-3",
        tone === "danger" ? "text-alert hover:bg-alert/10" : "text-fg hover:bg-tint/[0.07]",
      )}
    >
      {children}
      <span className="max-sm:sr-only">{label}</span>
    </button>
  );
}
