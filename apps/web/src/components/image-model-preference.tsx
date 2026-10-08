"use client";

/**
 * Which image models the design agent may use. Lists only models the
 * selected image key can reach; preferences for unreachable models are
 * ignored when a run starts (see resolveImagePreference).
 */
import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useImageModelPreference } from "../hooks/use-image-model-preference";
import { useImageModels } from "../lib/account-context";
import { describeIssue } from "../lib/generation-errors";
import { QUALITY_LABEL } from "../lib/image-model-meta";
import { cn } from "../lib/utils";
import { Segmented } from "./ui/select";

const POPOVER_WIDTH = 340;

export function ImageModelPreferencePopover({
  open,
  onClose,
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const { preference, setMode, toggleModel } = useImageModelPreference();
  const { data, loading, error } = useImageModels();
  const models = data ?? [];
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  // Open toward the side with more room.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < 380 && rect.top > spaceBelow;
    setPos({
      top: above ? rect.top - 8 : rect.bottom + 8,
      left: Math.max(8, Math.min(rect.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8)),
      above,
    });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;
  const manual = preference.mode === "manual";

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="生图模型偏好"
      style={{
        top: pos.above ? undefined : pos.top,
        bottom: pos.above ? window.innerHeight - pos.top : undefined,
        left: pos.left,
        width: POPOVER_WIDTH,
      }}
      className="fixed z-[9999] rounded-lg glass shadow-float"
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-fg">助手用哪些生图模型</p>
          <p className="mt-1 text-[12px] leading-snug text-fg-muted">
            {manual
              ? "只在勾选的模型里挑。都取消就回到自动。"
              : "按任务自动挑选当前 Key 可用的模型。"}
          </p>
        </div>
        <Segmented
          value={preference.mode}
          onValueChange={(mode) => setMode(mode === "manual" ? "manual" : "auto")}
          ariaLabel="选择方式"
          className="h-8 shrink-0"
          options={[
            { value: "auto", label: "自动" },
            {
              value: "manual",
              label: "指定",
              disabled: preference.models.length === 0,
              title: preference.models.length === 0 ? "先在下面勾选模型" : "指定",
            },
          ]}
        />
      </div>

      <div className="max-h-[300px] overflow-y-auto border-t border-line p-1.5">
        {error ? (
          <div className="px-2.5 py-3 text-[12.5px] leading-relaxed text-fg-soft">
            {describeIssue(error, null).title}。
            <Link href="/settings?tab=keys" className="ml-0.5 text-fg underline underline-offset-2">
              去选择 Key
            </Link>
          </div>
        ) : loading && models.length === 0 ? (
          <div className="space-y-1.5 p-1.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-white/[0.05]" />
            ))}
          </div>
        ) : models.length === 0 ? (
          <p className="px-2.5 py-3 text-[12.5px] text-fg-muted">当前 Key 没有可用的生图模型。</p>
        ) : (
          models.map((m) => {
            const selected = manual && preference.models.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                role="checkbox"
                aria-checked={selected}
                onClick={() => toggleModel(m.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
                  selected ? "bg-white/[0.05]" : "hover:bg-white/[0.06]",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                    selected ? "border-fg bg-fg text-ground" : "border-line-strong",
                  )}
                >
                  {selected ? <CheckIcon className="size-3" strokeWidth={2.5} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg">
                    {m.displayName}
                  </span>
                  <span className="block truncate text-[11.5px] text-fg-muted">
                    {m.description}
                  </span>
                </span>
                <span className="data-label shrink-0 text-fg-muted">
                  {QUALITY_LABEL[m.maxQuality ?? "hd"]}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  );
}
