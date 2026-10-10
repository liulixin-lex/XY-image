"use client";

import type { BrandKitAsset } from "@loomic/shared";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { loadFontStylesheet } from "../../lib/font-api";
import { cn } from "../../lib/utils";
import { FontPickerDialog } from "./font-picker-dialog";
import { InlineInput } from "./inline-input";
import { SectionHeader } from "./section-header";

interface FontSectionProps {
  fonts: BrandKitAsset[];
  onAddFont: (data: {
    family: string;
    variant: string;
    category: string;
  }) => void;
  onDeleteFont: (assetId: string) => void;
  onUpdateLabel: (assetId: string, name: string) => void;
}

export function FontSection({
  fonts,
  onAddFont,
  onDeleteFont,
  onUpdateLabel,
}: FontSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [menuOpen]);

  // Load each brand font in full (proxy first, Google directly as fallback);
  // loadFontStylesheet skips families that are already on the page.
  useEffect(() => {
    for (const font of fonts) {
      if (font.text_content) loadFontStylesheet(font.text_content);
    }
  }, [fonts]);

  const handleManualInput = useCallback(() => {
    setMenuOpen(false);
    const name = window.prompt("输入字体名称");
    if (!name?.trim()) return;
    onAddFont({ family: name.trim(), variant: "regular", category: "sans-serif" });
  }, [onAddFont]);

  const handlePickerSelect = useCallback(
    (font: { family: string; variant: string; category: string }) => {
      onAddFont(font);
    },
    [onAddFont],
  );

  return (
    <section>
      <SectionHeader title="字体" count={fonts.length} />
      <div className="flex flex-wrap gap-3">
        {fonts.map((font) => (
          <div key={font.id} className="flex flex-col items-center gap-1.5">
            <div className="relative group">
              <div className="flex h-[113px] w-[150px] items-center justify-center rounded-[14px] bg-panel shadow-card">
                <span
                  className="text-[32px] text-fg select-none"
                  style={{
                    fontFamily: font.text_content
                      ? `"${font.text_content}", sans-serif`
                      : undefined,
                  }}
                >
                  Ag
                </span>
              </div>
              <button
                type="button"
                onClick={() => onDeleteFont(font.id)}
                className={cn(
                  "absolute -top-2 -right-2 flex size-6 cursor-pointer items-center justify-center rounded-full bg-panel text-fg-soft shadow-card transition-[opacity,color] hover:text-alert",
                  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-acc [@media(hover:none)]:opacity-100",
                )}
                aria-label={`删除字体「${font.display_name}」`}
              >
                <X aria-hidden className="size-3.5" strokeWidth={2.2} />
              </button>
            </div>
            <InlineInput
              value={font.display_name}
              onCommit={(name) => onUpdateLabel(font.id, name)}
              className="w-[150px]"
              inputClassName="truncate text-center text-[12px] text-fg-soft"
            />
          </div>
        ))}

        {/* Add button with dropdown menu */}
        <div className="flex flex-col items-center gap-1.5">
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="flex h-[113px] w-[150px] cursor-pointer items-center justify-center rounded-[14px] border border-dashed border-line-strong bg-tint/[0.03] text-fg-muted transition-colors outline-none hover:border-acc hover:bg-acc-soft hover:text-acc-text focus-visible:outline-2 focus-visible:outline-acc"
              aria-label="添加字体"
            >
              <Plus aria-hidden className="size-5" strokeWidth={2} />
            </button>

            {menuOpen && (
              <div className="glass-strong absolute top-full left-0 z-50 mt-1.5 w-[188px] rounded-[14px] p-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setPickerOpen(true);
                  }}
                  className="flex w-full cursor-pointer items-center rounded-[9px] px-3 py-2 text-[13px] text-fg transition-colors hover:bg-tint/[0.07]"
                >
                  从字体库选择
                </button>
                <button
                  type="button"
                  onClick={handleManualInput}
                  className="flex w-full cursor-pointer items-center rounded-[9px] px-3 py-2 text-[13px] text-fg transition-colors hover:bg-tint/[0.07]"
                >
                  手动输入字体名称
                </button>
              </div>
            )}
          </div>
          <span className="text-[12px] text-fg-muted">添加</span>
        </div>
      </div>

      {pickerOpen && (
        <FontPickerDialog
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={handlePickerSelect}
        />
      )}
    </section>
  );
}
