"use client";

import type { BrandKitAsset } from "@loomic/shared";
import { Plus, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { ColorPickerPopover } from "./color-picker-popover";
import { InlineInput } from "./inline-input";
import { SectionHeader } from "./section-header";

interface ColorSectionProps {
  colors: BrandKitAsset[];
  onAddColor: (name: string, hex: string) => void;
  onUpdateColor: (assetId: string, name: string, hex: string) => void;
  onDeleteColor: (assetId: string) => void;
  onUpdateLabel: (assetId: string, name: string) => void;
}

export function ColorSection({
  colors,
  onAddColor,
  onUpdateColor,
  onDeleteColor,
  onUpdateLabel,
}: ColorSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<BrandKitAsset | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const editAnchorRef = useRef<HTMLDivElement>(null);

  const handleAddClick = useCallback(() => {
    setEditingAsset(null);
    setPickerOpen(true);
  }, []);

  const handleSwatchClick = useCallback((asset: BrandKitAsset) => {
    setEditingAsset(asset);
    setPickerOpen(true);
  }, []);

  const handlePickerSave = useCallback(
    (name: string, hex: string) => {
      if (editingAsset) {
        onUpdateColor(editingAsset.id, name, hex);
      } else {
        onAddColor(name, hex);
      }
    },
    [editingAsset, onAddColor, onUpdateColor],
  );

  const handlePickerClose = useCallback(() => {
    setPickerOpen(false);
    setEditingAsset(null);
  }, []);

  return (
    <section>
      <SectionHeader title="颜色" count={colors.length} />
      <div className="flex flex-wrap gap-3">
        {colors.map((color) => (
          <div key={color.id} className="flex flex-col items-center gap-1.5">
            <div className="relative group" ref={editingAsset?.id === color.id ? editAnchorRef : undefined}>
              <button
                type="button"
                onClick={() => handleSwatchClick(color)}
                className="size-[69px] cursor-pointer rounded-[14px] shadow-card ring-1 ring-tint/10 ring-inset transition-shadow outline-none hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
                style={{ backgroundColor: color.text_content ?? "#888888" }}
                aria-label={`修改颜色「${color.display_name}」`}
              />
              <button
                type="button"
                onClick={() => onDeleteColor(color.id)}
                className={cn(
                  "absolute -top-2 -right-2 flex size-6 cursor-pointer items-center justify-center rounded-full bg-panel text-fg-soft shadow-card transition-[opacity,color] hover:text-alert",
                  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-acc [@media(hover:none)]:opacity-100",
                )}
                aria-label={`删除颜色「${color.display_name}」`}
              >
                <X aria-hidden className="size-3.5" strokeWidth={2.2} />
              </button>
              {/* Popover anchored to the swatch being edited */}
              {editingAsset?.id === color.id && (
                <ColorPickerPopover
                  open={pickerOpen}
                  onClose={handlePickerClose}
                  onSave={handlePickerSave}
                  initialName={color.display_name}
                  initialHex={color.text_content ?? "#888888"}
                  mode="edit"
                  anchorRef={editAnchorRef}
                />
              )}
            </div>
            <InlineInput
              value={color.display_name}
              onCommit={(name) => onUpdateLabel(color.id, name)}
              className="w-[69px]"
              inputClassName="truncate text-center text-[12px] text-fg-soft"
            />
          </div>
        ))}

        {/* Add button */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="relative">
            <button
              ref={addButtonRef}
              type="button"
              onClick={handleAddClick}
              className="flex size-[69px] cursor-pointer items-center justify-center rounded-[14px] border border-dashed border-line-strong bg-tint/[0.03] text-fg-muted transition-colors outline-none hover:border-acc hover:bg-acc-soft hover:text-acc-text focus-visible:outline-2 focus-visible:outline-acc"
              aria-label="添加颜色"
            >
              <Plus aria-hidden className="size-5" strokeWidth={2} />
            </button>
            {/* Popover anchored to add button */}
            {!editingAsset && (
              <ColorPickerPopover
                open={pickerOpen}
                onClose={handlePickerClose}
                onSave={handlePickerSave}
                mode="create"
                anchorRef={addButtonRef}
              />
            )}
          </div>
          <span className="text-[12px] text-fg-muted">添加</span>
        </div>
      </div>
    </section>
  );
}
