"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownToLine,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Search,
  User,
} from "lucide-react";

import type { MarketplaceDetail, MarketplaceSkill } from "@loomic/shared";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/toast";
import {
  ApiApplicationError,
  getMarketplaceDetail,
  installMarketplaceSkill,
  searchMarketplace,
} from "@/lib/server-api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarketplacePanelProps {
  accessToken: () => string | undefined;
  onInstalled: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

// ---------------------------------------------------------------------------
// MarketplaceSkillCard
// ---------------------------------------------------------------------------

function MarketplaceSkillCard({
  skill,
  index,
  onClick,
}: {
  skill: MarketplaceSkill;
  /** Position in the grid, for the staggered entrance. */
  index: number;
  onClick: (skill: MarketplaceSkill) => void;
}) {
  const formattedDownloads =
    skill.downloads >= 1000
      ? `${(skill.downloads / 1000).toFixed(1)}k`
      : String(skill.downloads);

  return (
    <button
      type="button"
      onClick={() => onClick(skill)}
      style={{ "--stagger": Math.min(index, 12) } as CSSProperties}
      className="animate-enter group block w-full cursor-pointer rounded-[16px] bg-panel p-4 text-left shadow-card transition-[translate,box-shadow] duration-200 outline-none hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-tint/[0.07]">
            <Package aria-hidden className="size-4 text-fg-soft" />
          </div>
          <span className="truncate text-[15px] font-semibold text-fg">
            {skill.name}
          </span>
        </div>
        <span className="numeral shrink-0 text-[11px] text-fg-muted">
          v{skill.version}
        </span>
      </div>

      {/* Description */}
      <p className="mb-3 line-clamp-2 text-[13px] leading-relaxed text-fg-soft">
        {skill.description}
      </p>

      {/* Divider */}
      <div className="border-t border-line" />

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-[11px] text-fg-muted">
          <User className="size-3" />
          {skill.author}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-fg-muted">
          <Download className="size-3" />
          <span className="numeral">{formattedDownloads}</span>
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// MarketplaceDetailDialog
// ---------------------------------------------------------------------------

function MarketplaceDetailDialog({
  skill,
  open,
  onOpenChange,
  onInstall,
}: {
  skill: MarketplaceDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: (packageName: string) => Promise<void>;
}) {
  const [installing, setInstalling] = useState(false);

  const handleInstall = useCallback(async () => {
    if (!skill) return;
    setInstalling(true);
    try {
      await onInstall(skill.packageName);
    } finally {
      setInstalling(false);
    }
  }, [skill, onInstall]);

  if (!skill) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {skill.name}
            <span className="text-[11px] font-normal text-fg-muted">
              v{skill.version}
            </span>
          </DialogTitle>
          <DialogDescription>{skill.description}</DialogDescription>
        </DialogHeader>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-0.5">
            <span className="text-fg-muted">作者</span>
            <p className="font-medium text-fg">{skill.author}</p>
          </div>
          {skill.license && (
            <div className="space-y-0.5">
              <span className="text-fg-muted">许可证</span>
              <p className="font-medium text-fg">{skill.license}</p>
            </div>
          )}
          <div className="space-y-0.5">
            <span className="text-fg-muted">包名</span>
            <p className="font-medium font-mono text-fg">
              {skill.packageName}
            </p>
          </div>
          {skill.homepage && (
            <div className="space-y-0.5">
              <span className="text-fg-muted">主页</span>
              <a
                href={skill.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-fg hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                链接
                <ExternalLink className="size-3" />
              </a>
            </div>
          )}
        </div>

        {/* Keywords */}
        {skill.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {skill.keywords.map((kw: string) => (
              <span
                key={kw}
                className="rounded-[6px] bg-tint/[0.06] px-2 py-0.5 text-[11px] text-fg-muted"
              >
                {kw}
              </span>
            ))}
          </div>
        )}

        {/* README */}
        {skill.readme && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-fg-muted">
              README
            </span>
            <pre className="max-h-64 overflow-auto rounded-[12px] bg-tint/[0.05] p-3 font-mono text-xs leading-relaxed text-fg whitespace-pre-wrap break-words">
              {skill.readme}
            </pre>
          </div>
        )}

        <DialogFooter>
          <Button
            size="sm"
            disabled={installing}
            onClick={handleInstall}
          >
            {installing ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                安装中...
              </>
            ) : (
              <>
                <ArrowDownToLine className="size-3.5" />
                安装
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// MarketplacePanel
// ---------------------------------------------------------------------------

export function MarketplacePanel({
  accessToken,
  onInstalled,
}: MarketplacePanelProps) {
  const { success, error: showError } = useToast();

  // Search state
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);

  // Results state
  const [skills, setSkills] = useState<MarketplaceSkill[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Detail dialog state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSkill, setDetailSkill] = useState<MarketplaceDetail | null>(
    null,
  );

  // Prevent stale responses from overwriting newer queries
  const searchSeqRef = useRef(0);

  // ---------------------------------------------------------------------------
  // Search effect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const token = accessToken();
    if (!token) return;

    const trimmed = debouncedQuery.trim();
    if (!trimmed) {
      setSkills([]);
      setTotal(0);
      setSearched(false);
      return;
    }

    const seq = ++searchSeqRef.current;

    (async () => {
      setLoading(true);
      try {
        const result = await searchMarketplace(token, trimmed);
        // Only apply if this is still the latest search
        if (seq === searchSeqRef.current) {
          setSkills(result.skills);
          setTotal(result.total);
          setSearched(true);
        }
      } catch (err) {
        console.error("[marketplace] search failed:", err);
        if (seq === searchSeqRef.current) {
          setSkills([]);
          setTotal(0);
          setSearched(true);
        }
      } finally {
        if (seq === searchSeqRef.current) {
          setLoading(false);
        }
      }
    })();
  }, [debouncedQuery, accessToken]);

  // ---------------------------------------------------------------------------
  // Detail
  // ---------------------------------------------------------------------------

  const handleCardClick = useCallback(
    async (skill: MarketplaceSkill) => {
      const token = accessToken();
      if (!token) return;

      setDetailLoading(true);
      setDetailOpen(true);

      try {
        const detail = await getMarketplaceDetail(token, skill.packageName);
        setDetailSkill(detail);
      } catch (err) {
        console.error("[marketplace] detail fetch failed:", err);
        // Fallback: construct a minimal detail object from the list item
        setDetailSkill({
          ...skill,
          readme: "",
          versions: [skill.version],
          tarballUrl: "",
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [accessToken],
  );

  // ---------------------------------------------------------------------------
  // Install
  // ---------------------------------------------------------------------------

  const handleInstall = useCallback(
    async (packageName: string) => {
      const token = accessToken();
      if (!token) return;

      try {
        await installMarketplaceSkill(token, packageName);
        setDetailOpen(false);
        success("技能已安装");
        await onInstalled();
      } catch (err) {
        const msg =
          err instanceof ApiApplicationError
            ? err.message
            : "安装失败，请重试";
        showError(msg);
        console.error("[marketplace] install failed:", err);
      }
    },
    [accessToken, onInstalled, success, showError],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      {/* Search input */}
      <div className="relative mb-4 sm:mb-6 sm:max-w-md">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-muted" />
        <input
          type="search"
          placeholder="搜索 skills.sh 市场"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索市场技能"
          className="h-11 w-full rounded-[10px] bg-tint/[0.06] pr-9 pl-8.5 text-sm text-fg caret-acc outline-none transition-shadow placeholder:text-fg-muted focus:shadow-[inset_0_0_0_1px_var(--acc)] sm:h-9"
        />
        {loading && (
          <Loader2 aria-label="正在搜索" className="absolute top-1/2 right-3 size-3.5 -translate-y-1/2 animate-spin text-acc-text" />
        )}
      </div>

      {/* Empty state - not yet searched */}
      {!searched && !loading && (
        <div className="animate-enter flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-[14px] bg-tint/[0.07]">
            <Package className="size-5 text-fg-muted" />
          </div>
          <p className="font-display text-[20px] text-fg">
            搜索社区技能
          </p>
          <p className="mt-1.5 text-[13px] text-fg-soft">
            输入关键词搜索 skills.sh 上的社区技能包
          </p>
        </div>
      )}

      {/* Empty state - no results */}
      {searched && skills.length === 0 && !loading && (
        <div className="animate-enter flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-[14px] bg-tint/[0.07]">
            <Search className="size-5 text-fg-muted" />
          </div>
          <p className="font-display text-[20px] text-fg">
            没有找到匹配的技能
          </p>
          <p className="mt-1.5 text-[13px] text-fg-soft">
            换个关键词再搜
          </p>
        </div>
      )}

      {/* Results count */}
      {searched && skills.length > 0 && (
        <p className="mb-4 text-xs text-fg-soft">
          找到 <span className="numeral">{total}</span> 个技能
        </p>
      )}

      {/* Results grid */}
      {skills.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          {skills.map((skill, index) => (
            <MarketplaceSkillCard
              key={skill.packageName}
              index={index}
              skill={skill}
              onClick={handleCardClick}
            />
          ))}
        </div>
      )}

      {/* Detail dialog */}
      <MarketplaceDetailDialog
        skill={detailSkill}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setDetailSkill(null);
        }}
        onInstall={handleInstall}
      />

      {/* Loading overlay for detail fetch. Portalled so it sits above the
          (portalled) dialog instead of inside <main>'s stacking context. */}
      {detailLoading && detailOpen
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <Loader2 className="size-6 animate-spin text-fg-muted" />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
