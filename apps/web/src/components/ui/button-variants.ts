import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

// No "use client": server components (not-found.tsx) style links with
// buttonVariants too, and a function from a client module cannot be called
// during the static export's server render.

/**
 * Buttons in the soft-poster world.
 *
 * - `accent`: the one action that matters on a screen (生成, 登录). Coral.
 * - `default`: a strong secondary action. Graphite ink, inverts in dark.
 * - `outline` / `secondary` / `ghost`: quiet actions, tinted from the theme.
 * - `slant`: the poster cut (skewed, softly rounded). The label is wrapped
 *   in an upright `sk-in` span automatically; when you use `buttonVariants`
 *   on an `<a>`, wrap the label yourself.
 * - size `poster`: tall, display-face label for the main call to action.
 */
export const buttonVariantsRaw = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[10px] border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,scale,translate] duration-150 ease-out outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:translate-y-px active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-fg text-ground hover:bg-fg/88",
        accent:
          "bg-acc font-semibold text-acc-ink shadow-acc hover:bg-acc-hover disabled:shadow-none",
        outline:
          "border-line-strong bg-transparent text-fg hover:bg-tint/[0.05] aria-expanded:bg-tint/[0.06]",
        secondary:
          "bg-tint/[0.06] text-fg hover:bg-tint/[0.1] aria-expanded:bg-tint/[0.1]",
        ghost:
          "text-fg-soft hover:bg-tint/[0.06] hover:text-fg aria-expanded:bg-tint/[0.06] aria-expanded:text-fg",
        destructive:
          "bg-alert-wash text-alert hover:bg-alert/15",
        link: "text-fg underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 rounded-[7px] px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[8px] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 rounded-[12px] px-5 text-[15px] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        poster:
          "h-12 gap-2 rounded-[14px] px-6 font-display text-[19px] font-normal tracking-[0.02em] [&_svg:not([class*='size-'])]:size-[18px]",
        icon: "size-8",
        "icon-xs": "size-6 rounded-[7px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-[8px]",
        "icon-lg": "size-10 rounded-[12px]",
      },
      slant: {
        true: "sk",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      slant: false,
    },
  }
)

/**
 * Variant classes run through tailwind-merge, so they are safe to put on a
 * plain `<a>` too: without the merge, the base `border-transparent` would win
 * over a variant's border colour (the outline button lost its border).
 */
export function buttonVariants(props?: Parameters<typeof buttonVariantsRaw>[0]) {
  return cn(buttonVariantsRaw(props))
}
