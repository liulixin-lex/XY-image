"use client";

import type {
  BrandKitAsset,
  BrandKitDetail,
  BrandKitAssetType,
} from "@loomic/shared";
import { Copy, Ellipsis, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { ColorSection } from "./color-section";
import { FontSection } from "./font-section";
import { GuidanceSection } from "./guidance-section";
import { ImageSection } from "./image-section";
import { InlineInput } from "./inline-input";
import { LogoSection } from "./logo-section";

interface BrandKitEditorProps {
  kit: BrandKitDetail;
  onUpdateKit: (data: {
    name?: string;
    guidance_text?: string | null;
    is_default?: boolean;
  }) => void;
  onDeleteKit: () => void;
  onDuplicateKit: () => void;
  onAddAsset: (
    type: BrandKitAssetType,
    displayName: string,
    textContent?: string | null,
    metadata?: Record<string, unknown>,
  ) => void;
  onUpdateAsset: (
    assetId: string,
    data: { display_name?: string; text_content?: string | null },
  ) => void;
  onDeleteAsset: (assetId: string) => void;
  onUploadAsset: (type: "logo" | "image", file: File) => void;
}

function filterAssets(
  assets: BrandKitAsset[],
  type: BrandKitAssetType,
): BrandKitAsset[] {
  return assets.filter((a) => a.asset_type === type);
}

export function BrandKitEditor({
  kit,
  onUpdateKit,
  onDeleteKit,
  onAddAsset,
  onUpdateAsset,
  onDeleteAsset,
  onDuplicateKit,
  onUploadAsset,
}: BrandKitEditorProps) {
  const colors = useMemo(() => filterAssets(kit.assets, "color"), [kit.assets]);
  const fonts = useMemo(() => filterAssets(kit.assets, "font"), [kit.assets]);
  const logos = useMemo(() => filterAssets(kit.assets, "logo"), [kit.assets]);
  const images = useMemo(() => filterAssets(kit.assets, "image"), [kit.assets]);

  const handleNameCommit = useCallback(
    (name: string) => onUpdateKit({ name }),
    [onUpdateKit],
  );

  const handleGuidanceSave = useCallback(
    (text: string | null) => onUpdateKit({ guidance_text: text }),
    [onUpdateKit],
  );

  const handleToggleDefault = useCallback(() => {
    onUpdateKit({ is_default: !kit.is_default });
  }, [kit.is_default, onUpdateKit]);

  // Color handlers
  const handleAddColor = useCallback(
    (name: string, hex: string) => onAddAsset("color", name, hex),
    [onAddAsset],
  );
  const handleUpdateColor = useCallback(
    (assetId: string, name: string, hex: string) =>
      onUpdateAsset(assetId, { display_name: name, text_content: hex }),
    [onUpdateAsset],
  );
  const handleUpdateColorLabel = useCallback(
    (assetId: string, name: string) =>
      onUpdateAsset(assetId, { display_name: name }),
    [onUpdateAsset],
  );

  // Font handlers
  const handleAddFont = useCallback(
    (data: { family: string; variant: string; category: string }) => {
      const weight = data.variant === "regular" ? "400" : data.variant;
      const displayName = `${data.family} ${weight === "400" ? "Regular" : weight}`;
      onAddAsset("font", displayName, data.family, {
        weight,
        category: data.category,
        source: "google_fonts",
      });
    },
    [onAddAsset],
  );
  const handleUpdateFontLabel = useCallback(
    (assetId: string, name: string) =>
      onUpdateAsset(assetId, { display_name: name }),
    [onUpdateAsset],
  );

  // Logo/Image label handlers
  const handleUpdateLogoLabel = useCallback(
    (assetId: string, name: string) =>
      onUpdateAsset(assetId, { display_name: name }),
    [onUpdateAsset],
  );
  const handleUpdateImageLabel = useCallback(
    (assetId: string, name: string) =>
      onUpdateAsset(assetId, { display_name: name }),
    [onUpdateAsset],
  );

  // Upload handlers
  const handleUploadLogo = useCallback(
    (file: File) => onUploadAsset("logo", file),
    [onUploadAsset],
  );
  const handleUploadImage = useCallback(
    (file: File) => onUploadAsset("image", file),
    [onUploadAsset],
  );

  return (
    <div className="glass flex min-h-[60dvh] min-w-0 flex-1 flex-col overflow-hidden rounded-[20px]">
      {/* Header */}
      <header className="flex min-h-[64px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6 md:h-[88px] md:flex-nowrap md:py-0">
        <InlineInput
          value={kit.name}
          onCommit={handleNameCommit}
          placeholder="套件名称"
          inputClassName="font-display text-[30px] font-normal text-fg"
        />

        <div className="flex shrink-0 items-center gap-3 md:ml-4">
          {/* Apply to new projects toggle */}
          <span id="brand-kit-default-label" className="text-[13px] whitespace-nowrap text-fg-soft">
            应用到新项目
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={kit.is_default}
            aria-labelledby="brand-kit-default-label"
            onClick={handleToggleDefault}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
              kit.is_default ? "bg-acc" : "bg-tint/[0.12]",
            )}
          >
            <span
              className={cn(
                "inline-block size-4 rounded-full bg-white shadow-subtle transition-transform",
                kit.is_default ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>

          {/* Divider */}
          <div className="h-5 w-px bg-line" />

          {/* More menu */}
          <MoreMenu
            onDuplicate={onDuplicateKit}
            onDelete={onDeleteKit}
          />
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 md:px-[80px] xl:px-[160px]">
        <div className="mx-auto flex max-w-[960px] flex-col gap-9">
          {/* TODO(brand-kit): "从网址提取品牌" was a disabled placeholder upstream;
              add it back only once the server can fetch and parse a site. */}
          <GuidanceSection
            value={kit.guidance_text}
            onSave={handleGuidanceSave}
          />

          <LogoSection
            logos={logos}
            onDelete={onDeleteAsset}
            onUpdateLabel={handleUpdateLogoLabel}
            onUpload={handleUploadLogo}
          />

          <ColorSection
            colors={colors}
            onAddColor={handleAddColor}
            onUpdateColor={handleUpdateColor}
            onDeleteColor={onDeleteAsset}
            onUpdateLabel={handleUpdateColorLabel}
          />

          <FontSection
            fonts={fonts}
            onAddFont={handleAddFont}
            onDeleteFont={onDeleteAsset}
            onUpdateLabel={handleUpdateFontLabel}
          />

          <ImageSection
            images={images}
            onDelete={onDeleteAsset}
            onUpdateLabel={handleUpdateImageLabel}
            onUpload={handleUploadImage}
          />
        </div>
      </div>
    </div>
  );
}

// --- More menu (⋯) dropdown ---

function MoreMenu({
  onDuplicate,
  onDelete,
}: {
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex size-8 cursor-pointer items-center justify-center rounded-[10px] text-fg-soft transition-colors outline-none hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
        aria-label="更多操作"
        aria-expanded={open}
      >
        <Ellipsis className="size-[18px]" />
      </button>

      {open && (
        <div className="glass-strong absolute top-full right-0 z-50 mt-1.5 w-[148px] rounded-[14px] p-1.5">
          <button
            type="button"
            onClick={() => {
              onDuplicate();
              setOpen(false);
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13px] text-fg transition-colors hover:bg-tint/[0.07]"
          >
            <Copy className="size-4 text-fg-muted" />
            复制
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete();
              setOpen(false);
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13px] text-alert transition-colors hover:bg-alert-wash"
          >
            <Trash2 className="h-4 w-4" />
            删除套件
          </button>
        </div>
      )}
    </div>
  );
}
