"use client";

import type { BrandKitAsset } from "@loomic/shared";
import { Image as ImageIcon, Plus, X } from "lucide-react";

import { cn } from "../../lib/utils";
import { InlineInput } from "./inline-input";

// --- AssetCard ---

interface AssetCardProps {
  asset: BrandKitAsset;
  onDelete: (assetId: string) => void;
  onUpdateLabel: (assetId: string, name: string) => void;
}

export function AssetCard({ asset, onDelete, onUpdateLabel }: AssetCardProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative group">
        <div className="flex h-[113px] w-[150px] items-center justify-center overflow-hidden rounded-[14px] bg-panel shadow-card">
          {asset.file_url ? (
            <img
              src={asset.file_url}
              alt={asset.display_name}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon aria-hidden className="size-8 text-fg-muted" strokeWidth={1.5} />
          )}
        </div>
        <button
          type="button"
          onClick={() => onDelete(asset.id)}
          className={cn(
            "absolute -top-2 -right-2 flex size-6 cursor-pointer items-center justify-center rounded-full bg-panel text-fg-soft shadow-card transition-[opacity,color] hover:text-alert",
            "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-acc [@media(hover:none)]:opacity-100",
          )}
          aria-label={`删除「${asset.display_name}」`}
        >
          <X aria-hidden className="size-3.5" strokeWidth={2.2} />
        </button>
      </div>
      <InlineInput
        value={asset.display_name}
        onCommit={(name) => onUpdateLabel(asset.id, name)}
        className="w-[150px]"
        inputClassName="truncate text-center text-[12px] text-fg-soft"
      />
    </div>
  );
}

// --- AddAssetCard ---

interface AddAssetCardProps {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}

export function AddAssetCard({
  label,
  disabled = false,
  onClick,
}: AddAssetCardProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "flex h-[113px] w-[150px] items-center justify-center rounded-[14px] border border-dashed border-line-strong bg-tint/[0.03] text-fg-muted transition-colors outline-none focus-visible:outline-2 focus-visible:outline-acc",
          disabled
            ? "cursor-not-allowed opacity-40"
            : "cursor-pointer hover:border-acc hover:bg-acc-soft hover:text-acc-text",
        )}
        aria-label={label}
      >
        <Plus aria-hidden className="size-5" strokeWidth={2} />
      </button>
      <span className="text-[12px] text-fg-muted">{label}</span>
    </div>
  );
}
