"use client";

import type { ChatSessionSummary } from "@loomic/shared";
import {
  ChevronDownIcon,
  HistoryIcon,
  SearchIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type SessionSelectorProps = {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onDelete: (sessionId: string) => void;
};

export function SessionSelector({
  sessions,
  activeSessionId,
  onSelect,
  onNewChat,
  onDelete,
}: SessionSelectorProps) {
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const [open, setOpen] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = search.trim()
    ? sessions.filter((s) =>
        s.title.toLowerCase().includes(search.toLowerCase()),
      )
    : sessions;

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setConfirmingId(null);
    setSearch("");
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Close on an outside click or Escape; focus the search field on open.
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        close(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(true);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, close]);

  const handleSelect = useCallback(
    (sessionId: string) => {
      onSelect(sessionId);
      close(false);
    },
    [onSelect, close],
  );

  const handleDelete = useCallback(
    (sessionId: string) => {
      onDelete(sessionId);
      setConfirmingId(null);
    },
    [onDelete],
  );

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <div className="relative min-w-0" ref={panelRef}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (open ? close(false) : setOpen(true))}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={`历史对话：${activeSession?.title ?? "未选择"}`}
          className="inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-[10px] px-2 text-[12.5px] text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
        >
          <HistoryIcon
            aria-hidden
            className="size-3.5 shrink-0"
            strokeWidth={2}
          />
          <span className="truncate">{activeSession?.title ?? "历史对话"}</span>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 opacity-60 transition-transform",
              open && "rotate-180",
            )}
            strokeWidth={2}
          />
        </button>

        {open && (
          <div className="glass-strong absolute top-full left-0 z-50 mt-1.5 w-[280px] overflow-hidden rounded-[14px]">
            <div className="px-3 pt-3 pb-2">
              <p className="mb-2 text-[12px] font-semibold text-fg">历史对话</p>
              <div className="relative">
                <SearchIcon
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-muted"
                  strokeWidth={2}
                />
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索对话标题"
                  aria-label="搜索对话标题"
                  className="h-8 w-full rounded-[9px] bg-tint/[0.06] pr-2 pl-8 text-[12.5px] text-fg caret-acc placeholder:text-fg-muted outline-none transition-shadow focus:shadow-[inset_0_0_0_1px_var(--acc)]"
                />
              </div>
            </div>

            <ul
              id={listId}
              aria-label="历史对话"
              className="max-h-[260px] overflow-y-auto px-1.5 pb-1.5"
            >
              {filtered.length === 0 && (
                <li className="px-3 py-5 text-center text-[12px] text-fg-muted">
                  {search ? "没有找到匹配的对话" : "还没有对话"}
                </li>
              )}
              {filtered.map((s) => {
                const active = s.id === activeSessionId;
                if (confirmingId === s.id) {
                  return (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 rounded-[9px] bg-alert-wash px-2.5 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
                        删除「{s.title}」？
                      </span>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="h-7 shrink-0 rounded-[7px] px-2 text-[12px] text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(s.id)}
                        className="h-7 shrink-0 rounded-[7px] bg-alert px-2.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acc"
                      >
                        删除
                      </button>
                    </li>
                  );
                }
                // Select and delete are sibling buttons (no nested controls).
                return (
                  <li
                    key={s.id}
                    className={cn(
                      "group flex items-center gap-1 rounded-[9px] transition-colors",
                      active ? "bg-acc-soft" : "hover:bg-tint/[0.06]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(s.id)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "min-w-0 flex-1 truncate rounded-[9px] px-2.5 py-2 text-left text-[12.5px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acc",
                        active
                          ? "font-semibold text-acc-text"
                          : "text-fg-soft hover:text-fg",
                      )}
                    >
                      {s.title}
                    </button>
                    <button
                      type="button"
                      aria-label={`删除对话 ${s.title}`}
                      title="删除对话"
                      onClick={() => setConfirmingId(s.id)}
                      className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-[7px] text-fg-muted opacity-0 transition-[opacity,color] group-hover:opacity-100 hover:text-alert focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-acc [@media(hover:none)]:opacity-100"
                    >
                      <Trash2Icon
                        aria-hidden
                        className="size-3.5"
                        strokeWidth={2}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onNewChat}
        className="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
        title="新对话"
        aria-label="新对话"
      >
        <SquarePenIcon aria-hidden className="size-4" strokeWidth={1.9} />
      </button>
    </div>
  );
}
