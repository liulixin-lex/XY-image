"use client";

import {
  MoreHorizontal,
  ShieldCheck,
  Sparkles,
  Users,
  UserPen,
} from "lucide-react";
import { useCallback } from "react";
import type { CSSProperties } from "react";

import type { SkillCategory, SkillListItem, SkillSource } from "@loomic/shared";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { SKILL_CATEGORY_LABELS } from "./categories";

// ---------------------------------------------------------------------------
// Category badge colour mapping
// ---------------------------------------------------------------------------

// All neutral for now; the coral accent is kept for state (enabled, featured).
const CATEGORY_STYLES: Record<SkillCategory, string> = {
  design: "bg-tint/[0.07] text-fg-soft",
  generation: "bg-tint/[0.07] text-fg-soft",
  code: "bg-tint/[0.07] text-fg-soft",
  data: "bg-tint/[0.07] text-fg-soft",
  writing: "bg-tint/[0.07] text-fg-soft",
  custom: "bg-tint/[0.07] text-fg-soft",
};

// ---------------------------------------------------------------------------
// Source badge
// ---------------------------------------------------------------------------

const SOURCE_CONFIG: Record<
  SkillSource,
  { label: string; icon: typeof ShieldCheck }
> = {
  system: { label: "官方", icon: ShieldCheck },
  community: { label: "社区", icon: Users },
  user: { label: "自定义", icon: UserPen },
};

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "relative z-10 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc sm:h-5 sm:w-9",
        checked ? "bg-acc" : "bg-tint/[0.12]",
      )}
    >
      {/* The knob slides with a slight overshoot (CSS), like a spring. */}
      <span
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-white shadow-subtle transition-[translate] duration-200 ease-[cubic-bezier(0.34,1.4,0.64,1)] motion-reduce:transition-none sm:size-3.5",
          checked ? "translate-x-[22px]" : "translate-x-1",
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// SkillCard
// ---------------------------------------------------------------------------

interface SkillCardProps {
  skill: SkillListItem;
  onToggle: (skillId: string, enabled: boolean) => void;
  onClick: (skill: SkillListItem) => void;
  onUninstall?: (skillId: string) => void;
  /** Position in the grid, for the staggered entrance. */
  index?: number;
}

export function SkillCard({
  skill,
  onToggle,
  onClick,
  onUninstall,
  index = 0,
}: SkillCardProps) {
  // SOURCE_CONFIG exhaustively covers all SkillSource values ("system" | "community" | "user")
  // Non-null assertion is safe: every possible SkillSource key is present in SOURCE_CONFIG.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const sourceEntry =
    (SOURCE_CONFIG[skill.source as keyof typeof SOURCE_CONFIG] ?? SOURCE_CONFIG.system)!;
  const { label: sourceLabel, icon: SourceIcon } = sourceEntry;

  const handleToggle = useCallback(
    (next: boolean) => {
      onToggle(skill.id, next);
    },
    [onToggle, skill.id],
  );

  const formattedDate = new Date(skill.updatedAt).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return (
    // The name is the card's one link-like control; its ::after covers the
    // card so a click anywhere opens the detail. The switch and the menu sit
    // above it (z-10) as their own controls.
    <div
      style={{ "--stagger": Math.min(index, 12) } as CSSProperties}
      className="animate-enter group relative rounded-[16px] bg-panel p-4 shadow-card transition-[translate,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover has-[[data-popup-open]]:shadow-card-hover"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "shrink-0 rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium",
              CATEGORY_STYLES[skill.category],
            )}
          >
            {SKILL_CATEGORY_LABELS[skill.category] ?? skill.category}
          </span>
          <button
            type="button"
            onClick={() => onClick(skill)}
            className="cursor-pointer truncate text-left text-[15px] font-semibold text-fg outline-none after:absolute after:inset-0 after:rounded-[16px] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-acc"
          >
            {skill.name}
          </button>
          {skill.isFeatured && (
            <Sparkles
              aria-label="精选"
              className="size-3.5 shrink-0 text-acc-text"
            />
          )}
        </div>

        <ToggleSwitch
          checked={skill.enabled ?? false}
          onChange={handleToggle}
          label={`启用「${skill.name}」`}
        />
      </div>

      {/* Description */}
      <p className="mb-3 line-clamp-2 text-[13px] leading-relaxed text-fg-soft">
        {skill.description}
      </p>

      {/* Divider */}
      <div className="border-t border-line" />

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 rounded-full bg-tint/[0.06] px-2 py-0.5 text-[11px] font-medium text-fg-soft">
          <SourceIcon className="size-3" />
          {sourceLabel}
        </span>

        <div className="flex items-center gap-2">
          <span className="numeral text-[11px] text-fg-muted">
            {formattedDate}
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`「${skill.name}」更多操作`}
                  className="relative z-10 flex size-7 items-center justify-center rounded-[8px] text-fg-muted opacity-0 transition-[opacity,color] outline-none group-hover:opacity-100 hover:bg-tint/[0.07] hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-acc data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                />
              }
            >
              <MoreHorizontal aria-hidden className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4}>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onClick(skill);
                }}
              >
                查看详情
              </DropdownMenuItem>
              {skill.installed && onUninstall && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUninstall(skill.id);
                  }}
                >
                  卸载
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
