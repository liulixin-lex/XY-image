"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GoogleFontItem } from "../../lib/font-api";
import { fetchGoogleFonts, loadFontStylesheet } from "../../lib/font-api";

interface FontPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (font: { family: string; variant: string; category: string }) => void;
}

const CATEGORIES = [
  { value: "", label: "全部字体" },
  { value: "sans-serif", label: "无衬线" },
  { value: "serif", label: "衬线" },
  { value: "display", label: "展示" },
  { value: "handwriting", label: "手写" },
  { value: "monospace", label: "等宽" },
];

const PAGE_SIZE = 50;

export function FontPickerDialog({
  open,
  onClose,
  onSelect,
}: FontPickerDialogProps) {
  const [fonts, setFonts] = useState<GoogleFontItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<GoogleFontItem | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch fonts on open / search / category change / retry. A slower earlier
  // response must not overwrite a newer one, hence `cancelled`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt only re-runs the fetch
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    clearTimeout(searchTimer.current);
    setStatus("loading");
    searchTimer.current = setTimeout(async () => {
      try {
        const result = await fetchGoogleFonts(search || undefined, category || undefined);
        if (cancelled) return;
        setFonts(result);
        setVisibleCount(PAGE_SIZE);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.warn("[brand-kit] font list failed", err);
        setFonts([]);
        setStatus("failed");
      }
    }, search ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(searchTimer.current);
    };
  }, [open, search, category, attempt]);

  /* Escape closes, matching every other dialog. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Each preview only needs the glyphs of its own name, so ask for that
  // subset (see loadFontStylesheet: proxy first, Google directly as fallback).
  const visibleKey = open ? fonts.slice(0, visibleCount).map((f) => f.family).join("\n") : "";
  useEffect(() => {
    if (!visibleKey) return;
    for (const family of visibleKey.split("\n")) loadFontStylesheet(family, { text: family });
  }, [visibleKey]);

  // Scroll handler for loading more
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, fonts.length));
    }
  }, [fonts.length]);

  const handleAdd = useCallback(() => {
    if (!selected) return;
    onSelect({
      family: selected.family,
      variant: selected.variants.includes("regular") ? "regular" : selected.variants[0] ?? "400",
      category: selected.category,
    });
    onClose();
  }, [selected, onSelect, onClose]);

  if (!open) return null;

  const visibleFonts = fonts.slice(0, visibleCount);

  // Portalled to <body>: inside the workspace <main> (its own stacking
  // context) the overlay would sit under the sticky nav and the mobile
  // bottom bar, which stayed clickable while the dialog was open.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ground/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="添加字体"
        className="glass-strong flex max-h-[520px] w-full max-w-[420px] flex-col overflow-hidden rounded-[18px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search */}
        <div className="border-b border-line p-3">
          <input
            type="text"
            placeholder="搜索字体"
            aria-label="搜索字体"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full px-3 text-[13px] rounded-[10px] bg-tint/[0.06] text-fg caret-acc placeholder:text-fg-muted outline-none transition-shadow focus:shadow-[inset_0_0_0_1px_var(--acc)]"
          />
        </div>

        {/* Category filter */}
        <div className="border-b border-line px-3 py-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="字体分类"
            className="cursor-pointer rounded-[8px] bg-transparent text-[13px] text-fg-soft outline-none focus-visible:outline-2 focus-visible:outline-acc"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Font list */}
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto min-h-0"
        >
          {visibleFonts.map((font) => (
              <button
                key={font.family}
                type="button"
                onClick={() => setSelected(font)}
                aria-pressed={selected?.family === font.family}
                className={`w-full cursor-pointer px-4 py-2 text-left text-base text-fg outline-none focus-visible:bg-tint/[0.07] ${
                  selected?.family === font.family
                    ? "bg-acc-soft text-acc-text"
                    : "hover:bg-tint/[0.06]"
                }`}
                style={{ fontFamily: `"${font.family}", sans-serif` }}
              >
                {font.family}
              </button>
          ))}
          {fonts.length === 0 &&
            (status === "failed" ? (
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <p className="text-sm text-fg-soft">字体库没有加载出来</p>
                <button
                  type="button"
                  onClick={() => setAttempt((n) => n + 1)}
                  className="h-8 cursor-pointer rounded-[9px] bg-tint/[0.07] px-3 text-[13px] text-fg transition-colors hover:bg-tint/[0.11]"
                >
                  重试
                </button>
              </div>
            ) : (
              <output className="block p-6 text-center text-sm text-fg-muted">
                {status === "loading"
                  ? "正在加载字体…"
                  : search
                    ? `没有找到「${search}」相关的字体`
                    : category
                      ? "这个分类下暂时没有字体"
                      : "字体库暂时是空的。可以先关掉这里，用「添加 › 手动输入字体名称」"}
              </output>
            ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-line p-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 cursor-pointer rounded-[10px] px-4 text-[13px] text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!selected}
            className="h-9 cursor-pointer rounded-[10px] bg-acc px-4 text-[13px] font-semibold text-acc-ink transition-colors hover:bg-acc-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:cursor-not-allowed disabled:opacity-40"
          >
            添加
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
