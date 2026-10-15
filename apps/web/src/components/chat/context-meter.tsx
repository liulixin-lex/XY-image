"use client";

/**
 * 第 70 条 上下文: how full this conversation's context is (approximate
 * tokens against a 100k window), and 压缩 by hand. At 80 % the server
 * summarises older turns on its own (apps/server/src/agent/context-window.ts);
 * the meter follows `context.updated` events while a run streams and asks
 * GET /api/agent/sessions/:id/context when a conversation opens.
 */
import { CHAT_CONTEXT_COMPACT_AT } from "@loomic/shared";
import { LoaderIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { SessionContext } from "../../lib/server-api";
import { cn } from "../../lib/utils";

const POPOVER_WIDTH = 260;

function k(tokens: number) {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

export function ContextMeter({
  usage,
  onCompact,
  compacting,
  running,
}: {
  usage: SessionContext | null;
  onCompact: () => void;
  compacting: boolean;
  /** A run is answering: 压缩 waits for it. */
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({
      top: rect.top - 8,
      left: Math.max(8, Math.min(rect.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const used = usage?.usedTokens ?? 0;
  const window_ = usage?.windowTokens ?? 100_000;
  const ratio = Math.min(1, used / window_);
  const percent = Math.round(ratio * 100);
  const tone = ratio >= CHAT_CONTEXT_COMPACT_AT ? "danger" : ratio >= 0.6 ? "acc" : "muted";
  const r = 7;
  const circumference = 2 * Math.PI * r;
  const label = usage ? `上下文约 ${k(used)} / ${k(window_)}（${percent}%）` : "上下文";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-fg-soft transition-colors hover:bg-tint/[0.07] focus-visible:outline-2 focus-visible:outline-acc"
      >
        {compacting ? (
          <LoaderIcon className="size-4 animate-spin" strokeWidth={1.75} />
        ) : (
          <svg viewBox="0 0 18 18" className="size-[18px] -rotate-90" aria-hidden>
            <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2.2" className="stroke-tint/[0.14]" />
            <circle
              cx="9"
              cy="9"
              r={r}
              fill="none"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - Math.max(ratio, usage && used > 0 ? 0.04 : 0))}
              className={cn(
                "transition-[stroke-dashoffset] duration-500",
                tone === "danger" ? "stroke-alert" : tone === "acc" ? "stroke-acc" : "stroke-fg-muted",
              )}
            />
          </svg>
        )}
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="上下文"
              style={{ bottom: window.innerHeight - pos.top, left: pos.left, width: POPOVER_WIDTH }}
              className="fixed z-[9999] rounded-lg glass-menu p-3.5 shadow-float"
            >
              <p className="text-[13.5px] font-semibold text-fg">上下文</p>
              <p className="mt-1 text-[12.5px] text-fg-soft">
                {usage ? (
                  <>
                    约 <span className="font-medium tabular-nums text-fg">{k(used)}</span> / {k(window_)}（{percent}%）
                  </>
                ) : (
                  "读取中…"
                )}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-tint/[0.08]">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500",
                    tone === "danger" ? "bg-alert" : tone === "acc" ? "bg-acc" : "bg-fg-muted",
                  )}
                  style={{ width: `${Math.max(percent, used > 0 ? 2 : 0)}%` }}
                />
              </div>
              <p className="mt-2.5 text-[12px] leading-relaxed text-fg-muted">
                到 {Math.round(CHAT_CONTEXT_COMPACT_AT * 100)}% 会自动把较早的对话压缩成摘要，最近几轮保留原文。
                {usage?.compacted ? "这段对话已经压缩过。" : ""}
              </p>
              <button
                type="button"
                disabled={running || compacting || !usage || used < 2_000}
                onClick={() => {
                  onCompact();
                  setOpen(false);
                }}
                title={running ? "等这一轮回复结束再压缩" : used < 2_000 ? "对话还很短，不用压缩" : undefined}
                className="mt-3 h-8 w-full rounded-[10px] bg-fg text-[12.5px] font-medium text-ground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:cursor-not-allowed disabled:opacity-40"
              >
                {compacting ? "压缩中…" : "现在压缩"}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
