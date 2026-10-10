"use client";

import React from "react";

type MentionPillProps = {
  label: string;
  kind: "image-model" | "brand-kit-asset" | "skill";
};

const MENTION_KIND: Record<MentionPillProps["kind"], string> = {
  "image-model": "模型",
  "brand-kit-asset": "品牌套件",
  skill: "技能",
};

/**
 * Inline pill displaying a user mention (model or brand-kit asset).
 * Memoized because it receives stable string props and re-renders frequently
 * inside streaming message lists.
 */
export const MentionPill = React.memo(function MentionPill({
  label,
  kind,
}: MentionPillProps) {
  return (
    // Follows currentColor: it sits inside the inked user bubble.
    <span className="mx-0.5 inline-flex h-[22px] items-center gap-1 rounded-[7px] bg-current/12 px-1.5 align-middle">
      <span className="text-[11px] leading-none opacity-70">
        {MENTION_KIND[kind]}
      </span>
      <span className="max-w-[120px] truncate text-[11px] leading-none">
        {label}
      </span>
    </span>
  );
});
