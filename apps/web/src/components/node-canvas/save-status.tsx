"use client";

/** Whether the board is on the server yet, for the canvas header. */
import { CheckIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import type {
  NodeCanvasStore,
  SaveStatus as Status,
} from "../../lib/node-canvas/store";
import { cn } from "../../lib/utils";

const COPY: Record<Status, string> = {
  saved: "已保存",
  dirty: "正在保存",
  saving: "正在保存",
  error: "还没保存上，正在重试",
};

const idle = () => () => {};
const saved = (): Status => "saved";

export function SaveStatus({
  store,
  className,
}: { store: NodeCanvasStore | null; className?: string }) {
  const status = useSyncExternalStore(
    store ? store.subscribe : idle,
    store ? () => store.getState().saveStatus : saved,
    saved,
  );
  if (!store) return null;
  return (
    <output
      aria-live="polite"
      className={cn(
        "flex items-center gap-1 text-[12px] whitespace-nowrap",
        status === "error" ? "text-warn" : "text-fg-muted",
        className,
      )}
    >
      {status === "saved" ? (
        <CheckIcon className="size-3.5" strokeWidth={2} aria-hidden />
      ) : null}
      {COPY[status]}
    </output>
  );
}
