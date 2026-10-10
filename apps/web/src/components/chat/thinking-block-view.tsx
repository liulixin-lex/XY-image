"use client";

import { AnimatePresence, motion } from "framer-motion";
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

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-[6px] text-[12px] font-medium text-fg-muted transition-colors hover:text-fg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
        aria-expanded={expanded || isStreaming}
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

      <AnimatePresence>
        {(expanded || isStreaming) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-1.5 overflow-hidden"
          >
            <div className="ml-[6px] border-l border-line-strong pl-3 text-[12px] leading-relaxed whitespace-pre-wrap text-fg-muted">
              {thinking || "\u2014"}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
