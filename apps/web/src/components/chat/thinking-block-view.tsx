"use client";

import { ChevronRightIcon } from "lucide-react";
import React, { useState } from "react";

import { LiveDot } from "@/components/ambient/live-dot";
import { cn } from "@/lib/utils";

type ThinkingBlockViewProps = {
  thinking: string;
  isStreaming: boolean;
};

/**
 * Collapsible thinking block with streaming animation.
 *
 * - During streaming: the live dot + thinking text
 * - After streaming: collapses into a 「思考过程」 toggle
 *
 * Memoized to avoid re-rendering non-streaming thinking blocks when new
 * message deltas arrive in the same message.
 */
export const ThinkingBlockView = React.memo(function ThinkingBlockView({
  thinking,
  isStreaming,
}: ThinkingBlockViewProps) {
  const [expanded, setExpanded] = useState(false);
  const open = expanded || isStreaming;

  return (
    <div className="animate-enter">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-[6px] text-[12px] font-medium text-fg-muted transition-colors hover:text-fg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
        aria-expanded={open}
        aria-label={isStreaming ? "助手正在思考" : "展开或收起思考过程"}
      >
        {isStreaming ? (
          <>
            <LiveDot className="mx-[3px] size-1.5" />
            <span>正在思考…</span>
          </>
        ) : (
          <>
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-3.5 transition-transform duration-200",
                expanded && "rotate-90",
              )}
              strokeWidth={2}
            />
            <span>思考过程</span>
          </>
        )}
      </button>

      {/* Expands with the grid-rows 0fr → 1fr transition: real height
          animation in CSS, no measuring. Collapsed text stays out of the
          accessibility tree and tab order. */}
      <div
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out motion-reduce:transition-none",
          open ? "mt-1.5 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="ml-[6px] border-l border-line-strong pl-3 text-[12px] leading-relaxed whitespace-pre-wrap text-fg-muted">
            {thinking || "\u2014"}
          </div>
        </div>
      </div>
    </div>
  );
});
