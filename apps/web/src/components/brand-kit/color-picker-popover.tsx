"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";

import { cn } from "../../lib/utils";

interface ColorPickerPopoverProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, hex: string) => void;
  initialName?: string;
  initialHex?: string;
  mode: "create" | "edit";
  anchorRef: React.RefObject<HTMLElement | null>;
}

const HEX_RE = /^[0-9A-Fa-f]{6}$/;
const SHORT_HEX_RE = /^[0-9A-Fa-f]{3}$/;

/** "#e8553d", "E8553D" and "f60" (→ #FF6600) are all accepted. */
export function normalizeHex(raw: string): string | null {
  const cleaned = raw.trim().replace(/^#/, "");
  if (HEX_RE.test(cleaned)) return `#${cleaned.toUpperCase()}`;
  if (SHORT_HEX_RE.test(cleaned))
    return `#${[...cleaned].map((c) => c + c).join("").toUpperCase()}`;
  return null;
}

export function ColorPickerPopover({
  open,
  onClose,
  onSave,
  initialName = "",
  initialHex = "#6366F1",
  mode,
  anchorRef,
}: ColorPickerPopoverProps) {
  const [name, setName] = useState(initialName);
  const [hex, setHex] = useState(initialHex);
  const [hexInput, setHexInput] = useState(initialHex.replace("#", ""));
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync initial values when popover opens
  useEffect(() => {
    if (open) {
      setName(initialName);
      setHex(initialHex);
      setHexInput(initialHex.replace("#", ""));
    }
  }, [open, initialName, initialHex]);

  // Outside click detection
  useEffect(() => {
    if (!open) return;

    function handleMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, onClose, anchorRef]);

  const handlePickerChange = useCallback((newHex: string) => {
    const upper = newHex.toUpperCase();
    setHex(upper);
    setHexInput(upper.replace("#", ""));
  }, []);

  const handleHexInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Pasted values usually carry the "#"; the field shows it separately.
      const raw = e.target.value.trim().replace(/^#/, "");
      setHexInput(raw);
      const normalized = normalizeHex(raw);
      if (normalized) setHex(normalized);
    },
    [],
  );

  // A half-typed value would otherwise save the previous colour silently.
  const hexValid = normalizeHex(hexInput) !== null;
  const handleSave = useCallback(() => {
    if (!hexValid) return;
    const trimmedName = name.trim() || hex;
    onSave(trimmedName, hex);
    onClose();
  }, [hexValid, name, hex, onSave, onClose]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "glass-menu absolute z-50 w-[260px] rounded-[16px] p-3",
        "flex flex-col gap-2.5",
      )}
    >
      {/* Name input */}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="颜色名称"
        className="h-9 w-full px-2.5 text-[13px] rounded-[10px] bg-tint/[0.06] text-fg caret-acc placeholder:text-fg-muted outline-none transition-shadow focus:shadow-[inset_0_0_0_1px_var(--acc)]"
      />

      {/* Color picker */}
      <div className="[&_.react-colorful]:!w-full [&_.react-colorful]:!h-[160px] [&_.react-colorful]:rounded-[12px]">
        <HexColorPicker color={hex} onChange={handlePickerChange} />
      </div>

      {/* Preview + hex input */}
      <div className="flex items-center gap-2">
        <div
          className="size-9 shrink-0 rounded-[10px] ring-1 ring-tint/15 ring-inset"
          style={{ backgroundColor: hex }}
        />
        <div className="flex h-9 flex-1 items-center gap-0.5 rounded-[10px] bg-tint/[0.06] px-2.5 text-[13px] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--acc)]">
          <span className="text-fg-muted">#</span>
          <input
            type="text"
            value={hexInput}
            onChange={handleHexInputChange}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            maxLength={7}
            aria-label="颜色值"
            aria-invalid={!hexValid}
            className="numeral w-full bg-transparent text-[13px] text-fg uppercase caret-acc outline-none"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="h-8 cursor-pointer rounded-[9px] px-3 text-[13px] text-fg-soft transition-colors hover:bg-tint/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hexValid}
          className="h-8 cursor-pointer rounded-[9px] bg-acc px-3.5 text-[13px] font-semibold text-acc-ink transition-colors hover:bg-acc-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:cursor-not-allowed disabled:bg-tint/[0.1] disabled:text-fg-muted"
        >
          {mode === "create" ? "添加" : "保存"}
        </button>
      </div>
    </div>
  );
}
