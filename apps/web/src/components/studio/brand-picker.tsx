"use client";

/**
 * 品牌 in the studio (第 58 条): pick one of the account's brand kits and its
 * colours, fonts and guidance go along with every picture until it is turned
 * off (lib/brand-prompt.ts). The choice is remembered on this device. Kits
 * are listed when the menu opens, and the chosen one is re-read then, so an
 * edit on the 品牌套件 page shows up without reloading the studio.
 */
import type { BrandKitSummary } from "@loomic/shared";
import { CheckIcon, PaletteIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchBrandKit, fetchBrandKits } from "@/lib/brand-kit-api";
import { brandBlock } from "@/lib/brand-prompt";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";

const BRAND_KEY = "xy:studio-brand";
const LOGO_KEY = "xy:studio-brand-logo";
/** Signed brand-kit URLs last an hour; re-read the kit before then. */
export const BRAND_LOGO_FRESH_MS = 45 * 60 * 1000;

export type StudioBrand = {
  id: string;
  name: string;
  /** The paragraph appended to prompts; null when the kit has nothing usable. */
  block: string | null;
  colors: string[];
  /** The kit's first logo, a signed URL (one hour); null without a logo. */
  logoUrl: string | null;
  /** When the kit was read, for the signed URL's age. */
  loadedAt: number;
};

export function useStudioBrand() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const [brand, setBrand] = useState<StudioBrand | null>(null);
  // 带上标志: the logo goes along as a reference image (remembered, off by default).
  const [useLogo, setUseLogoState] = useState(false);
  useEffect(() => {
    try {
      setUseLogoState(localStorage.getItem(LOGO_KEY) === "1");
    } catch {}
  }, []);
  const setUseLogo = useCallback((on: boolean) => {
    setUseLogoState(on);
    try {
      localStorage.setItem(LOGO_KEY, on ? "1" : "0");
    } catch {}
    console.info("[studio] brand logo", { on });
  }, []);

  const load = useCallback(
    async (id: string) => {
      if (!token) return null;
      try {
        const kit = await fetchBrandKit(token, id);
        const next: StudioBrand = {
          id: kit.id,
          name: kit.name,
          block: brandBlock(kit),
          colors: kit.assets
            .filter((a) => a.asset_type === "color" && a.text_content)
            .slice(0, 5)
            .map((a) => a.text_content as string),
          logoUrl: kit.assets.find((a) => a.asset_type === "logo" && a.file_url)?.file_url ?? null,
          loadedAt: Date.now(),
        };
        setBrand(next);
        return next;
      } catch (error) {
        console.warn("[studio] brand kit unavailable", error);
        setBrand(null);
        try {
          localStorage.removeItem(BRAND_KEY);
        } catch {}
        return null;
      }
    },
    [token],
  );

  // The kit chosen last time on this device.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !token) return;
    restored.current = true;
    let id: string | null = null;
    try {
      id = localStorage.getItem(BRAND_KEY);
    } catch {}
    if (id) void load(id);
  }, [token, load]);

  const choose = useCallback(
    async (id: string | null) => {
      try {
        if (id) localStorage.setItem(BRAND_KEY, id);
        else localStorage.removeItem(BRAND_KEY);
      } catch {}
      console.info("[studio] brand", { kit: id });
      if (!id) {
        setBrand(null);
        return;
      }
      await load(id);
    },
    [load],
  );

  return { brand, choose, reload: load, useLogo, setUseLogo };
}

export function BrandPicker({
  brand,
  onChoose,
  onReload,
  useLogo,
  onUseLogo,
}: {
  brand: StudioBrand | null;
  onChoose: (id: string | null) => void;
  onReload: (id: string) => void;
  useLogo: boolean;
  onUseLogo: (on: boolean) => void;
}) {
  const { session } = useAuth();
  const [kits, setKits] = useState<BrandKitSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  const openChange = (open: boolean) => {
    if (!open || !session?.access_token) return;
    void fetchBrandKits(session.access_token)
      .then(({ brandKits }) => {
        setKits(brandKits);
        setFailed(false);
      })
      .catch((error) => {
        console.warn("[studio] brand kits unavailable", error);
        setFailed(true);
      });
    if (brand) onReload(brand.id);
  };

  return (
    <Popover onOpenChange={openChange}>
      <span className="inline-flex items-center">
        <PopoverTrigger
          className={cn(
            "inline-flex h-7 max-w-[150px] items-center gap-1.5 rounded-[8px] px-2 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
            brand ? "bg-acc-soft text-acc-text" : "text-fg-soft hover:bg-tint/[0.06] hover:text-fg",
            brand && "rounded-r-none pr-1.5",
          )}
          title={brand ? `出图时带上「${brand.name}」的配色、字体和调性` : "出图时带上品牌套件"}
        >
          {brand?.colors.length ? (
            <span aria-hidden className="flex -space-x-1">
              {brand.colors.slice(0, 3).map((hex) => (
                <span key={hex} className="size-3 rounded-full ring-1 ring-panel" style={{ background: hex.startsWith("#") ? hex : `#${hex}` }} />
              ))}
            </span>
          ) : (
            <PaletteIcon className="size-3.5" strokeWidth={2} />
          )}
          <span className="truncate">{brand ? brand.name : "品牌"}</span>
          {brand && useLogo && brand.logoUrl ? <span className="shrink-0 text-[11px] opacity-80">+标志</span> : null}
        </PopoverTrigger>
        {brand ? (
          <button
            type="button"
            onClick={() => onChoose(null)}
            aria-label={`不再带上「${brand.name}」`}
            className="inline-flex h-7 items-center rounded-r-[8px] bg-acc-soft pr-1.5 pl-0.5 text-acc-text transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
          >
            <XIcon className="size-3.5" strokeWidth={2} />
          </button>
        ) : null}
      </span>
      <PopoverContent align="end" className="w-[280px] p-1.5">
        <p className="px-2.5 pt-1.5 pb-2 text-[12px] leading-relaxed text-fg-muted">
          选一个品牌套件，出图时自动带上它的配色、字体和调性。
        </p>
        {failed ? (
          <p className="px-2.5 py-2 text-[13px] text-fg-soft">品牌套件暂时读不到，稍后再试。</p>
        ) : kits === null ? (
          <div className="space-y-1.5 px-1.5 pb-1.5" aria-label="读取中">
            <div className="h-9 animate-breathe rounded-[9px]" />
            <div className="h-9 animate-breathe rounded-[9px]" />
          </div>
        ) : kits.length === 0 ? (
          <p className="px-2.5 py-2 text-[13px] text-fg-soft">还没有品牌套件。</p>
        ) : (
          <ul className="max-h-[260px] overflow-y-auto">
            {kits.map((kit) => {
              const active = brand?.id === kit.id;
              return (
                <li key={kit.id}>
                  <PopoverClose
                    onClick={() => onChoose(kit.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-tint/[0.06] focus-visible:bg-tint/[0.06] focus-visible:outline-none",
                      active && "font-semibold",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{kit.name}</span>
                    {kit.asset_counts ? (
                      <span className="shrink-0 text-[11.5px] text-fg-muted tabular">
                        {kit.asset_counts.color} 色 · {kit.asset_counts.font} 字体
                      </span>
                    ) : null}
                    {active ? <CheckIcon className="size-4 shrink-0 text-acc" strokeWidth={2.25} /> : null}
                  </PopoverClose>
                </li>
              );
            })}
          </ul>
        )}
        {brand?.logoUrl ? (
          <label className="mt-1 flex cursor-pointer items-start gap-3 border-t border-line px-2.5 pt-2.5 pb-1.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-fg">带上标志</span>
              <span className="block text-[11.5px] leading-snug text-fg-muted">
                把「{brand.name}」的标志作为最后一张参考图；模型可能把它画进画面。
              </span>
            </span>
            <Switch checked={useLogo} onCheckedChange={onUseLogo} aria-label="带上标志作为参考图" className="mt-0.5" />
          </label>
        ) : null}
        <div className="mt-1 flex items-center justify-between border-t border-line px-2.5 pt-2 pb-1 text-[12.5px]">
          {brand ? (
            <PopoverClose onClick={() => onChoose(null)} className="font-semibold text-fg-soft hover:text-fg">
              不用品牌
            </PopoverClose>
          ) : (
            <span />
          )}
          <Link href="/brand-kit" className="text-fg-muted underline-offset-4 hover:text-fg hover:underline">
            管理品牌套件
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
