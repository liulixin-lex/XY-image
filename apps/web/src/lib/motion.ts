"use client";

/**
 * GSAP with ScrollTrigger, registered once for the whole app (第 62 条:
 * scroll-linked, horizontal, pinned and 3D motion on the landing page).
 *
 * Rules every caller follows (DESIGN.md「Do」):
 * - Only transform and opacity are scrubbed; never width / height, never
 *   backdrop-filter, never the ambient CSS variables on <html>.
 * - Everything is created inside `gsap.matchMedia()` with MOTION_OK in the
 *   query, so prefers-reduced-motion gets the plain, static page.
 * - Content is visible by default; scripts only add movement on top.
 */
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

export { gsap, ScrollTrigger, SplitText, useGSAP };

/** Motion that moves things in space. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";

/** Wide screens with a mouse: pinned scenes and pointer tilt. */
export const DESKTOP_MOTION = `${MOTION_OK} and (min-width: 1024px)`;

/**
 * Tablets and narrow desktop windows too (第 63 条): a 983 px window used to
 * get the phone layout of every scene. Scenes that work at 768 px use this.
 */
export const TABLET_MOTION = `${MOTION_OK} and (min-width: 768px)`;

/** Pointer-driven tilt needs a precise pointer that can hover. */
export const POINTER_MOTION = `${MOTION_OK} and (hover: hover) and (pointer: fine)`;

/**
 * True on machines that composite in software (render tier "lite", see
 * lib/render-tier.ts). Per-frame 3D on many layers is skipped there; the
 * same scenes still pin and slide, flat.
 */
export function isLiteRender(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.dataset.render === "lite"
  );
}
