"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

/** On/off toggle (Base UI Switch). Pair it with a visible label or aria-label. */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-white/[0.08] p-px transition-colors outline-none hover:border-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amb data-checked:border-transparent data-checked:bg-fg data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block size-4 rounded-full bg-fg-soft shadow-sm transition-[translate,background-color] duration-150 ease-out data-checked:translate-x-4 data-checked:bg-ground motion-reduce:transition-none"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
