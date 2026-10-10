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
  /**
   * Options sharing a group key render under one labelled group, in the
   * order given. Ungrouped options render as plain items.
   */
  group?: { key: string; label: ReactNode };
};

type PickerSection = { key: string; label: ReactNode | null; options: PickerOption[] };

/** Consecutive options with the same group key form one section. */
function sectionsOf(options: PickerOption[]): PickerSection[] {
  const sections: PickerSection[] = [];
  for (const option of options) {
    const key = option.group?.key ?? "";
    const last = sections.at(-1);
    if (last && last.key === key) last.options.push(option);
    else sections.push({ key, label: option.group?.label ?? null, options: [option] });
  }
  return sections;
}

/**
 * Compact keyboard-accessible select used for model / quality / ratio /
 * key pickers. Built on Base UI Select; 10px trigger, glass popup.
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
  slant = false,
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
  /** Poster cut: slanted chip with an upright label (no chevron). */
  slant?: boolean;
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
          "inline-flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-[10px] border border-line bg-tint/[0.05] px-3 text-[13px] font-medium text-fg transition-colors outline-none hover:border-line-strong hover:bg-tint/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc data-disabled:cursor-not-allowed data-disabled:text-fg-muted data-popup-open:border-line-strong data-popup-open:bg-tint/[0.1]",
          slant && "sk justify-center border-transparent bg-tint/[0.055] font-semibold text-fg-soft hover:bg-tint/[0.09] hover:text-fg",
          className,
        )}
      >
        {slant ? (
          <span className="sk-in min-w-0 gap-1.5">
            {icon}
            <span className="min-w-0 truncate">{current ? current.text : placeholder}</span>
          </span>
        ) : (
          <>
            {icon}
            <span className="min-w-0 truncate">{current ? current.text : placeholder}</span>
            <SelectPrimitive.Icon className="ml-auto shrink-0 text-fg-muted">
              <ChevronsUpDownIcon className="size-3.5" strokeWidth={1.75} />
            </SelectPrimitive.Icon>
          </>
        )}
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
              {sectionsOf(options).map((section, index) =>
                section.label === null ? (
                  section.options.map(renderItem)
                ) : (
                  <SelectPrimitive.Group
                    key={`group:${section.key}`}
                    className={cn(index > 0 && "mt-1 border-t border-line pt-1")}
                  >
                    <SelectPrimitive.GroupLabel className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-fg-muted">
                      {section.label}
                    </SelectPrimitive.GroupLabel>
                    {section.options.map(renderItem)}
                  </SelectPrimitive.Group>
                ),
              )}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function renderItem(option: PickerOption) {
  return (
    <SelectPrimitive.Item
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      className="grid cursor-default grid-cols-[1fr_auto] items-center gap-x-3 rounded-lg px-2.5 py-2 text-[13px] text-fg outline-none select-none data-disabled:text-fg-muted data-highlighted:bg-tint/[0.08]"
    >
      <span className="min-w-0">
        <SelectPrimitive.ItemText className="block truncate font-medium">
          {option.label}
        </SelectPrimitive.ItemText>
        {option.description ? (
          <span className="mt-0.5 block text-xs text-fg-muted">{option.description}</span>
        ) : null}
      </span>
      <SelectPrimitive.ItemIndicator>
        <CheckIcon className="size-3.5 text-acc-text" strokeWidth={2.25} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

/**
 * Segmented choice for short fixed sets (1K / 2K, aspect ratios): a row of
 * slanted poster tabs, the chosen one inked. Radio-group semantics with
 * arrow-key movement; disabled options stay visible with a reason (title).
 */
export function Segmented({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
  size = "md",
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: ReactNode; disabled?: boolean; title?: string }>;
  ariaLabel: string;
  className?: string;
  /** `lg` renders the label as a big poster numeral (1K / 2K, counts). */
  size?: "md" | "lg";
}) {
  const move = (from: number, step: number) => {
    for (let i = 1; i <= options.length; i += 1) {
      const next = options[(from + step * i + options.length * i) % options.length];
      if (next && !next.disabled) return next.value;
    }
    return null;
  };
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-1.5", className)}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step) return;
              event.preventDefault();
              const next = move(index, step);
              if (next === null) return;
              onValueChange(next);
              const group = event.currentTarget.parentElement;
              requestAnimationFrame(() =>
                group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus(),
              );
            }}
            className={cn(
              "sk flex-1 rounded-[10px] px-3 whitespace-nowrap transition-[background-color,color,scale] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45",
              size === "lg" ? "numeral h-12 text-[26px]" : "h-9 text-[13px] font-semibold tabular",
              active
                ? "bg-fg text-ground"
                : "bg-tint/[0.055] text-fg-soft hover:bg-tint/[0.09] hover:text-fg",
            )}
          >
            <span className="sk-in">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
