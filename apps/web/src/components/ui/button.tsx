"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariantsRaw = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amb active:translate-y-px active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-fg text-ground hover:bg-white",
        /** The page's main action: near-white, glowing in the room's colour. */
        glow: "bg-fg font-semibold text-ground glow-amb hover:bg-white disabled:shadow-none",
        outline:
          "border-line-strong bg-white/[0.04] text-fg hover:border-white/30 hover:bg-white/[0.08] aria-expanded:bg-white/[0.08]",
        secondary:
          "bg-white/[0.08] text-fg hover:bg-white/[0.12] aria-expanded:bg-white/[0.12]",
        ghost:
          "text-fg-soft hover:bg-white/[0.06] hover:text-fg aria-expanded:bg-white/[0.06] aria-expanded:text-fg",
        destructive:
          "bg-alert-wash text-alert hover:bg-alert/20",
        link: "text-fg underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-5 text-[15px] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * Variant classes run through tailwind-merge, so they are safe to put on a
 * plain `<a>` too: without the merge, the base `border-transparent` would win
 * over a variant's border colour (the outline button lost its border).
 */
function buttonVariants(props?: Parameters<typeof buttonVariantsRaw>[0]) {
  return cn(buttonVariantsRaw(props))
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariantsRaw>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
}

export { Button, buttonVariants }
