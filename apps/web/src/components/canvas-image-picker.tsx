"use client";

import { useEffect, useRef } from "react";

export type CanvasImageItem = {
  kind: "canvas-image";
  id: string;
  name: string;
  thumbnailUrl: string;
  assetId: string;
  url: string;
  mimeType: string;
};

export type BrandKitMentionItem = {
  kind: "brand-kit-asset";
  id: string;
  label: string;
  assetType: "color" | "font" | "logo" | "image";
  textContent?: string | null;
  fileUrl?: string | null;
  thumbnailUrl?: string | null;
};

export type ImageModelMentionItem = {
  kind: "image-model";
  id: string;
  label: string;
  description?: string;
  iconUrl?: string;
};

export type SkillMentionItem = {
  kind: "skill";
  id: string;
  label: string;
  slug: string;
  description?: string;
};

export type MessageMentionPickerItem =
  | CanvasImageItem
  | BrandKitMentionItem
  | ImageModelMentionItem
  | SkillMentionItem;

type MessageMentionPickerProps = {
  items: MessageMentionPickerItem[];
  query?: string;
  onSelect: (item: MessageMentionPickerItem) => void;
  onClose: () => void;
};

function itemLabel(item: MessageMentionPickerItem): string {
  return item.kind === "canvas-image" ? item.name : item.label;
}

function itemKeywords(item: MessageMentionPickerItem): string[] {
  if (item.kind === "canvas-image") return [item.name];
  if (item.kind === "image-model") return [item.label, item.description ?? ""];
  if (item.kind === "skill") return [item.label, item.slug, item.description ?? ""];
  return [item.label, item.assetType, item.textContent ?? ""];
}

function groupTitle(kind: MessageMentionPickerItem["kind"]): string {
  if (kind === "canvas-image") return "本项目";
  if (kind === "brand-kit-asset") return "品牌套件";
  if (kind === "skill") return "技能";
  return "模型";
}

export function MessageMentionPicker({
  items,
  query,
  onSelect,
  onClose,
}: MessageMentionPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredItems = query
    ? items.filter((item) =>
        itemKeywords(item).some((keyword) =>
          keyword.toLowerCase().includes(query.toLowerCase()),
        ),
      )
    : items;

  const groupedItems = filteredItems.reduce<
    Record<MessageMentionPickerItem["kind"], MessageMentionPickerItem[]>
  >(
    (acc, item) => {
      acc[item.kind].push(item);
      return acc;
    },
    {
      "canvas-image": [],
      "brand-kit-asset": [],
      "image-model": [],
      "skill": [],
    },
  );

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (filteredItems.length === 0) {
    return (
      <div
        ref={containerRef}
        className="glass-strong absolute bottom-full left-3 mb-2 w-60 rounded-[14px] p-3"
      >
        <p className="text-[12px] text-fg-soft">
          {items.length === 0 ? "还没有可以引用的图片" : `没有匹配「${query}」的内容`}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="glass-strong absolute bottom-full left-3 mb-2 max-h-72 w-72 overflow-y-auto rounded-[14px]"
    >
      <div className="p-2">
        {(
          [
            "canvas-image",
            "brand-kit-asset",
            "image-model",
            "skill",
          ] as const
        ).map((kind) => {
          const sectionItems = groupedItems[kind];
          if (!sectionItems.length) return null;
          return (
            <div key={kind} className="mb-2 last:mb-0">
              <div className="mb-1 px-1.5 text-[11px] font-semibold text-fg-muted">
                {groupTitle(kind)}
              </div>
              {sectionItems.map((item) => (
                <button
                  key={`${item.kind}:${item.id}`}
                  type="button"
                  onClick={() => {
                    onSelect(item);
                    onClose();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left transition-colors hover:bg-acc-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acc"
                >
                  <PickerLeadingVisual item={item} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-fg">
                      {itemLabel(item)}
                    </div>
                    {item.kind === "brand-kit-asset" && (
                      <div className="truncate text-[11px] text-fg-muted">
                        {item.assetType}
                        {item.textContent ? ` · ${item.textContent}` : ""}
                      </div>
                    )}
                    {item.kind === "image-model" && item.description && (
                      <div className="truncate text-[11px] text-fg-muted">
                        {item.description}
                      </div>
                    )}
                    {item.kind === "skill" && item.description && (
                      <div className="truncate text-[11px] text-fg-muted">
                        {item.description}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PickerLeadingVisual({ item }: { item: MessageMentionPickerItem }) {
  if (item.kind === "canvas-image") {
    return (
      <img
        src={item.thumbnailUrl}
        alt={item.name}
        className="size-8 shrink-0 rounded-[8px] object-cover shadow-[inset_0_0_0_1px_var(--line)]"
      />
    );
  }

  if (item.kind === "brand-kit-asset" && item.thumbnailUrl) {
    return (
      <img
        src={item.thumbnailUrl}
        alt={item.label}
        className="size-8 shrink-0 rounded-[8px] object-cover shadow-[inset_0_0_0_1px_var(--line)]"
      />
    );
  }

  if (item.kind === "image-model" && item.iconUrl) {
    return (
      <img
        src={item.iconUrl}
        alt={item.label}
        className="size-8 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-tint/[0.07] text-[11px] font-semibold uppercase text-fg-soft">
      {item.kind === "brand-kit-asset"
        ? item.assetType.slice(0, 2)
        : item.kind === "skill"
          ? "SK"
          : "AI"}
    </div>
  );
}
