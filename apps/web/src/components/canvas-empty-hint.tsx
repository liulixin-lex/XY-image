"use client";

import { useEffect, useRef, useState } from "react";

type CanvasEmptyHintProps = {
  excalidrawApi: any;
  onOpenChat: () => void;
};

/**
 * Floating overlay hint shown when the Excalidraw canvas has no visible
 * elements. Pressing the `C` key opens the chat sidebar and focuses the
 * chat input textarea.
 */
export function CanvasEmptyHint({
  excalidrawApi,
  onOpenChat,
}: CanvasEmptyHintProps) {
  const [hasElements, setHasElements] = useState(false);
  const onOpenChatRef = useRef(onOpenChat);
  onOpenChatRef.current = onOpenChat;

  // Poll the Excalidraw API every 500ms to determine if the canvas contains
  // any non-deleted elements.
  useEffect(() => {
    function check() {
      if (!excalidrawApi) {
        setHasElements(false);
        return;
      }
      const elements: any[] = excalidrawApi.getSceneElements?.() ?? [];
      setHasElements(elements.some((el: any) => !el.isDeleted));
    }

    check();
    const id = setInterval(check, 500);
    return () => clearInterval(id);
  }, [excalidrawApi]);

  // Global keydown listener for the `C` shortcut.
  useEffect(() => {
    if (hasElements) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when the user is typing in an input or textarea.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // Also ignore if contentEditable
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        onOpenChatRef.current();

        // The textarea may not be in the DOM yet (sidebar was closed), so
        // retry focus with a short delay.
        requestAnimationFrame(() => {
          const textarea = document.querySelector<HTMLTextAreaElement>(
            "textarea[data-chat-input]",
          );
          if (textarea) {
            textarea.focus();
          } else {
            // Sidebar might animate open; retry once more.
            setTimeout(() => {
              document
                .querySelector<HTMLTextAreaElement>(
                  "textarea[data-chat-input]",
                )
                ?.focus();
            }, 100);
          }
        });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasElements]);

  if (hasElements) return null;

  // The `C` shortcut needs a keyboard: phones and tablets get the button
  // instead, in a line that wraps inside the screen.
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-8">
      <p className="hidden items-center gap-2 text-sm text-fg-muted md:pointer-fine:flex">
        按
        <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-frame glass px-1.5 font-mono text-xs text-fg-soft shadow-subtle">
          C
        </kbd>
        把想法告诉助手，或用底部工具栏的「生成」直接出图
      </p>
      <p className="max-w-xs text-center text-sm leading-relaxed text-fg-muted md:pointer-fine:hidden">
        点右上角的对话按钮把想法告诉助手，或用底部工具栏的「生成」直接出图
      </p>
    </div>
  );
}
