"use client";

import type { ChatSessionSummary } from "@loomic/shared";
import { MessageSquareIcon, PanelRightCloseIcon } from "lucide-react";

import { LiveDot } from "@/components/ambient/live-dot";
import { SessionSelector } from "@/components/session-selector";
import { BRAND } from "@/lib/brand";

/**
 * The design-assistant panel's frame (header, the open button when it is
 * collapsed, the connection banner). Kept apart from chat-sidebar.tsx, which
 * owns the conversation state.
 */

export function ChatPanelHeader({
  sessions,
  activeSessionId,
  showSessions,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onCollapse,
}: {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  /** False while the session list is loading. */
  showSessions: boolean;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onDeleteSession: (sessionId: string) => void;
  onCollapse: () => void;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-2 border-b border-line pr-2 pl-4">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="poster-label shrink-0 text-[19px] leading-none text-fg">
          {BRAND.agentName}
        </h2>
        {showSessions && (
          <SessionSelector
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={onSelectSession}
            onNewChat={onNewChat}
            onDelete={onDeleteSession}
          />
        )}
      </div>
      <button
        type="button"
        onClick={onCollapse}
        className="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
        title="收起对话"
        aria-label="收起对话"
      >
        <PanelRightCloseIcon
          aria-hidden
          className="size-4"
          strokeWidth={1.75}
        />
      </button>
    </div>
  );
}

/** The collapsed panel: a slanted glass chip over the canvas corner. */
export function ChatOpenButton({
  onOpen,
  streaming,
}: {
  onOpen: () => void;
  streaming: boolean;
}) {
  return (
    <button
      onClick={onOpen}
      type="button"
      aria-label={`打开${BRAND.agentName}`}
      className="sk glass-strong inline-flex h-10 items-center rounded-[11px] px-3.5 text-[13.5px] font-semibold text-fg transition-[translate] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:translate-y-px"
    >
      <span className="sk-in gap-2">
        <MessageSquareIcon
          aria-hidden
          className="size-4 text-acc-text"
          strokeWidth={2}
        />
        <span className="hidden sm:inline">{BRAND.agentName}</span>
        {streaming ? <LiveDot /> : null}
      </span>
    </button>
  );
}

/** A dropped connection, or a slow first connect. */
export function ChatConnectionBanner({ dropped }: { dropped: boolean }) {
  return (
    <output
      className={
        dropped
          ? "flex items-center gap-2 border-b border-line bg-warn-wash px-4 py-2"
          : "flex items-center gap-2 border-b border-line bg-tint/[0.04] px-4 py-2"
      }
    >
      <LiveDot {...(dropped ? { className: "bg-warn" } : {})} />
      <span className="text-[12px] text-fg-soft">
        {dropped ? "连接已断开，正在重连。进行中的生成不受影响。" : "正在连接…"}
      </span>
    </output>
  );
}
