import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-md border border-line-strong bg-white/[0.04] px-3.5 py-1 text-base text-fg transition-[border-color,box-shadow,background-color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-fg-muted hover:border-white/25 focus-visible:border-amb/70 focus-visible:bg-white/[0.06] focus-visible:shadow-[0_0_0_3px_rgb(var(--amb)/0.18)] focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-well disabled:text-fg-muted aria-invalid:border-alert aria-invalid:shadow-[0_0_0_3px_var(--alert-wash)] md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
