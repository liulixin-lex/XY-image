import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-[12px] border border-line bg-panel/80 px-3.5 py-1 text-base text-fg transition-[border-color,box-shadow,background-color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-fg-muted hover:border-line-strong focus-visible:border-acc/70 focus-visible:bg-panel focus-visible:shadow-[0_0_0_3px_var(--acc-soft)] focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-well disabled:text-fg-muted aria-invalid:border-alert aria-invalid:shadow-[0_0_0_3px_var(--alert-wash)] md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
