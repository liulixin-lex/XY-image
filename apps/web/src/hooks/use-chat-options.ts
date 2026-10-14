"use client";

import { type ChatEffort, CHAT_EFFORTS } from "@loomic/shared";
import { useCallback, useSyncExternalStore } from "react";

// 第 67 条: the design assistant's 思考强度 and 联网搜索, remembered in this
// browser. The run sends them as asked; the server keeps only what the
// chosen model takes (packages/shared chat-options.ts), and the controls
// show the same.
const EFFORT_KEY = "xy:agent-effort";
const SEARCH_KEY = "xy:agent-web-search";

export type ChatOptions = { effort: ChatEffort; webSearch: boolean };

const listeners = new Set<() => void>();
function emitChange() {
  for (const listener of listeners) listener();
}
function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

let cachedEffort: string | null | undefined;
let cachedSearch: string | null | undefined;
let cached: ChatOptions = { effort: "auto", webSearch: true };

/** Stored values; unknown or missing ones read as 自动 and 联网 on. */
export function readChatOptions(): ChatOptions {
  try {
    const effort = localStorage.getItem(EFFORT_KEY);
    const search = localStorage.getItem(SEARCH_KEY);
    if (effort !== cachedEffort || search !== cachedSearch) {
      cachedEffort = effort;
      cachedSearch = search;
      cached = {
        effort: (CHAT_EFFORTS as readonly string[]).includes(effort ?? "")
          ? (effort as ChatEffort)
          : "auto",
        webSearch: search !== "off",
      };
    }
    return cached;
  } catch {
    return cached;
  }
}

const serverSnapshot: ChatOptions = { effort: "auto", webSearch: true };

export function useChatOptions() {
  const options = useSyncExternalStore(
    subscribe,
    readChatOptions,
    () => serverSnapshot,
  );
  const setEffort = useCallback((effort: ChatEffort) => {
    try {
      if (effort === "auto") localStorage.removeItem(EFFORT_KEY);
      else localStorage.setItem(EFFORT_KEY, effort);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    emitChange();
  }, []);
  const setWebSearch = useCallback((on: boolean) => {
    try {
      if (on) localStorage.removeItem(SEARCH_KEY);
      else localStorage.setItem(SEARCH_KEY, "off");
    } catch {
      /* see above */
    }
    emitChange();
  }, []);
  return { ...options, setEffort, setWebSearch };
}
