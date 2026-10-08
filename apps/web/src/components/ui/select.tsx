"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PickerOption = {
  value: string;
  label: ReactNode;
  /** Plain text label used by the trigger and type-ahead. */
  text: string;
  description?: ReactNode;
  disabled?: boolean;
};

/**
 * Compact keyboard-accessible select used for model / quality / ratio /
 * key pickers. Built on Base UI Select; pill trigger, glass popup.
 */
export function Picker({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder = "请选择",
  disabled,
  className,
  popupClassName,
  side = "bottom",
  align = "start",
  icon,
}: {
  value: string | null;
  onValueChange: (value: string) => void;
  options: PickerOption[];
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  popupClassName?: string;
  side?: "top" | "bottom";
  align?: "start" | "end" | "center";
  icon?: ReactNode;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
      items={options.map((option) => ({ value: option.value, label: option.text }))}
      disabled={disabled}
      modal={false}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-line bg-white/[0.06] px-3 text-[13px] font-medium text-fg transition-colors outline-none hover:border-line-strong hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amb data-disabled:cursor-not-allowed data-disabled:text-fg-muted data-popup-open:border-line-strong data-popup-open:bg-white/[0.1]",
          className,
        )}
      >
        {icon}
        <span className="min-w-0 truncate">{current ? current.text : placeholder}</span>
        <SelectPrimitive.Icon className="ml-auto shrink-0 text-fg-muted">
          <ChevronsUpDownIcon className="size-3.5" strokeWidth={1.75} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          side={side}
          align={align}
          sideOffset={6}
          alignItemWithTrigger={false}
          className="z-[200] outline-none"
        >
          <SelectPrimitive.Popup
            className={cn(
              "glass-strong max-h-[min(360px,var(--available-height))] min-w-(--anchor-width) overflow-y-auto rounded-xl p-1.5 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0",
              popupClassName,
            )}
          >
            <SelectPrimitive.List>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="grid cursor-default grid-cols-[1fr_auto] items-center gap-x-3 rounded-lg px-2.5 py-2 text-[13px] text-fg outline-none select-none data-disabled:text-fg-muted data-highlighted:bg-white/[0.08]"
                >
                  <span className="min-w-0">
                    <SelectPrimitive.ItemText className="block truncate font-medium">
                      {option.label}
                    </SelectPrimitive.ItemText>
                    {option.description ? (
                      <span className="mt-0.5 block text-xs text-fg-muted">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  <SelectPrimitive.ItemIndicator>
                    <CheckIcon className="size-3.5 text-amb" strokeWidth={2.25} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/**
 * Segmented choice for short fixed sets (1K / 2K, aspect ratios).
 * Radio-group semantics; disabled options stay visible with a reason.
 */
export function Segmented({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: ReactNode; disabled?: boolean; title?: string }>;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-9 items-center rounded-full border border-line bg-white/[0.04] p-[3px]",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "h-full min-w-9 rounded-full px-3 text-[13px] tabular transition-[background-color,color,box-shadow] outline-none focus-visible:outline-2 focus-visible:outline-amb disabled:cursor-not-allowed disabled:text-fg-muted/50",
              active
                ? "bg-white/[0.14] font-semibold text-fg shadow-subtle"
                : "text-fg-soft hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
