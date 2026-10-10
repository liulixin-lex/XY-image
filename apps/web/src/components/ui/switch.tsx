"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

/** On/off toggle (Base UI Switch). Pair it with a visible label or aria-label. */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-tint/[0.14] p-[2px] transition-colors outline-none hover:bg-tint/[0.2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc data-checked:bg-acc data-checked:hover:bg-acc-hover data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block size-4 rounded-full bg-white shadow-[0_1px_3px_var(--shadow-2)] transition-[translate] duration-150 ease-out data-checked:translate-x-4 motion-reduce:transition-none"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
