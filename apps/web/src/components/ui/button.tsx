"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import type { VariantProps } from "class-variance-authority"

import { buttonVariants, type buttonVariantsRaw } from "./button-variants"

function Button({
  className,
  variant = "default",
  size = "default",
  slant = false,
  children,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariantsRaw>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({ variant, size, slant, className })}
      {...props}
    >
      {slant ? <span className="sk-in">{children}</span> : children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
