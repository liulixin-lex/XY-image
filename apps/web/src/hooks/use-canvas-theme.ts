"use client";

import { useTheme } from "next-themes";

/**
 * Theme for the canvas (React Flow colour mode, thumbnails, screenshots),
 * kept in step with the app.
 *
 * next-themes' `resolvedTheme` ignores `forcedTheme`: with
 * `<ThemeProvider forcedTheme="dark" enableSystem={false}>` it still reports
 * the stored/default theme ("light"). Reading `forcedTheme` first is what
 * makes the canvas actually dark.
 */
export function useCanvasTheme(): "dark" | "light" {
  const { forcedTheme, resolvedTheme } = useTheme();
  return (forcedTheme ?? resolvedTheme) === "dark" ? "dark" : "light";
}
