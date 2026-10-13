"use client";

import type { BrandKitAsset } from "@loomic/shared";
import { Pipette, Plus, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { paletteFromImage } from "../../lib/palette";
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
  /** The kit's first logo: 从标志取色 reads its colours (第 58 条). */
  logoUrl?: string | null;
}

export function ColorSection({
  colors,
  onAddColor,
  onUpdateColor,
  onDeleteColor,
  onUpdateLabel,
  logoUrl,
}: ColorSectionProps) {
  // 从标志取色: suggestions from the logo, added one by one or all at once.
  const [suggested, setSuggested] = useState<string[] | null>(null);
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const have = new Set(colors.map((c) => (c.text_content ?? "").toUpperCase()));
  const fresh = (suggested ?? []).filter((hex) => !have.has(hex));
  const readLogo = useCallback(async () => {
    if (!logoUrl) return;
    setReading(true);
    setReadFailed(false);
    try {
      const palette = await paletteFromImage(logoUrl);
      setSuggested(palette);
      console.info("[brand-kit] logo palette", { colors: palette.length });
    } catch (error) {
      console.warn("[brand-kit] logo palette failed", error);
      setReadFailed(true);
      setSuggested(null);
    } finally {
      setReading(false);
    }
  }, [logoUrl]);
  const addSuggested = useCallback(
    (hexes: string[]) => {
      let n = colors.length;
      for (const hex of hexes) onAddColor(`标志色 ${++n}`, hex);
      setSuggested((prev) => prev?.filter((hex) => !hexes.includes(hex)) ?? null);
    },
    [colors.length, onAddColor],
  );
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
      <SectionHeader
        title="颜色"
        count={colors.length}
        action={
          logoUrl ? (
            <button
              type="button"
              onClick={() => void readLogo()}
              disabled={reading}
              className="inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] font-semibold text-fg-soft transition-colors hover:bg-tint/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc disabled:opacity-50"
              title="读出标志里的主要颜色，挑几个加进来"
            >
              <Pipette className="size-3.5" strokeWidth={2} />
              {reading ? "正在读取" : "从标志取色"}
            </button>
          ) : null
        }
      />
      {readFailed ? (
        <p className="mb-3 text-[12.5px] text-fg-muted">这张标志读不出颜色，可以手动添加。</p>
      ) : suggested ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[14px] bg-tint/[0.04] p-3">
          <span className="mr-1 text-[12.5px] text-fg-soft">
            {fresh.length ? "标志里的颜色，点一下加进来：" : "标志里的颜色都已经在套件里了。"}
          </span>
          {fresh.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => addSuggested([hex])}
              title={`添加 ${hex}`}
              aria-label={`添加颜色 ${hex}`}
              className="flex items-center gap-1.5 rounded-[9px] bg-panel py-1 pr-2 pl-1 text-[12px] font-semibold text-fg shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:text-acc-text focus-visible:outline-2 focus-visible:outline-acc"
            >
              <span className="size-5 rounded-[6px] ring-1 ring-tint/10 ring-inset" style={{ backgroundColor: hex }} />
              <span className="font-mono tabular">{hex}</span>
            </button>
          ))}
          {fresh.length > 1 ? (
            <button
              type="button"
              onClick={() => addSuggested(fresh)}
              className="ml-auto rounded-[9px] px-2.5 py-1 text-[12.5px] font-semibold text-acc-text hover:bg-acc-soft focus-visible:outline-2 focus-visible:outline-acc"
            >
              全部添加
            </button>
          ) : null}
        </div>
      ) : null}
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
