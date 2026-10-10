"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Palette, Settings2 } from "lucide-react";

import type { BrandKitSummary } from "@loomic/shared";
import { useToast } from "@/components/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchBrandKits } from "@/lib/brand-kit-api";
import { updateProject } from "@/lib/server-api";

/** Radio value for "no brand kit"; the API itself stores null. */
const NONE = "__none__";

interface BrandKitSelectorProps {
  accessToken: string;
  projectId: string;
  currentBrandKitId: string | null;
  onBrandKitChange: (kitId: string | null) => void;
}

/**
 * Canvas top-bar brand-kit picker. Icon-only below sm so it fits next to the
 * logo and project name on phones; the menu is positioned by Base UI and
 * stays inside the viewport.
 */
export function BrandKitSelector({
  accessToken,
  projectId,
  currentBrandKitId,
  onBrandKitChange,
}: BrandKitSelectorProps) {
  const router = useRouter();
  const { error: toastError } = useToast();
  const [kits, setKits] = useState<BrandKitSummary[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [updating, setUpdating] = useState(false);

  // Use a ref for accessToken to prevent tab-switch reload cascades.
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  // Fetch brand kits on mount
  useEffect(() => {
    let cancelled = false;
    fetchBrandKits(accessTokenRef.current)
      .then((res) => {
        if (!cancelled) setKits(res.brandKits);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn("[brand-kit] list failed", err);
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentKit = kits.find((k) => k.id === currentBrandKitId);
  const label = currentKit ? currentKit.name : "品牌套件";
  // A bound kit may not be in the list yet (still loading, or the list failed).
  const status = currentKit
    ? currentKit.name
    : currentBrandKitId
      ? "已选用"
      : "未使用";

  const handleSelect = useCallback(
    async (value: string) => {
      const kitId = value === NONE ? null : value;
      if (kitId === currentBrandKitId) return;
      setUpdating(true);
      try {
        await updateProject(accessTokenRef.current, projectId, {
          brand_kit_id: kitId,
        });
        onBrandKitChange(kitId);
      } catch (err) {
        // Keep the current kit; the radio group is controlled by the parent.
        console.warn("[brand-kit] project update failed", err);
        toastError("品牌套件没有切换成功，请稍后再试");
      } finally {
        setUpdating(false);
      }
    },
    [projectId, currentBrandKitId, onBrandKitChange, toastError],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={updating}
        aria-label={`品牌套件：${status}`}
        className="flex h-8 w-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line bg-panel/80 text-sm shadow-subtle backdrop-blur-xl transition-colors outline-none hover:border-line-strong focus-visible:outline-2 focus-visible:outline-acc disabled:opacity-50 sm:w-auto sm:px-2.5"
      >
        <Palette
          aria-hidden
          className={`size-4 shrink-0 ${currentBrandKitId ? "text-fg" : "text-fg-muted"}`}
        />
        <span className="hidden max-w-[120px] truncate sm:inline">{label}</span>
        <ChevronDown
          aria-hidden
          className="hidden size-3.5 shrink-0 opacity-50 sm:block"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-auto min-w-48 max-w-[min(280px,calc(100vw-24px))]"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>品牌套件</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={currentBrandKitId ?? NONE}
            onValueChange={(value: string) => void handleSelect(value)}
            disabled={updating}
          >
            <DropdownMenuRadioItem value={NONE} closeOnClick>
              不使用
            </DropdownMenuRadioItem>
            {kits.map((kit) => (
              <DropdownMenuRadioItem key={kit.id} value={kit.id} closeOnClick>
                <span className="truncate">{kit.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {kits.length === 0 && (
            <p className="px-1.5 py-1 text-sm text-muted-foreground">
              {loadFailed ? "品牌套件没有加载出来" : "还没有品牌套件"}
            </p>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/brand-kit")}>
          <Settings2 className="size-4" />
          管理品牌套件
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
