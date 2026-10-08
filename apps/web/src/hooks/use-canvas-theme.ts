"use client";

import { useTheme } from "next-themes";

/**
 * Theme for the Excalidraw canvas, kept in step with the app.
 *
 * next-themes' `resolvedTheme` ignores `forcedTheme`: with
 * `<ThemeProvider forcedTheme="dark" enableSystem={false}>` it still reports
 * the stored/default theme ("light"). Reading `forcedTheme` first is what
 * makes the canvas actually dark. (Before this, Excalidraw rendered a white
 * board under the dark chrome, and light text on it was unreadable.)
 */
export function useCanvasTheme(): "dark" | "light" {
  const { forcedTheme, resolvedTheme } = useTheme();
  return (forcedTheme ?? resolvedTheme) === "dark" ? "dark" : "light";
}

/**
 * Excalidraw's dark theme shows the scene through this CSS filter
 * (THEME_FILTER in @excalidraw/excalidraw 0.18), then un-inverts raster
 * images. Colour swatches for scene colours (e.g. the background picker)
 * apply it too, so a swatch looks like what the canvas will show; the stored
 * hex value itself is unchanged.
 */
export const CANVAS_DARK_FILTER = "invert(93%) hue-rotate(180deg)";
