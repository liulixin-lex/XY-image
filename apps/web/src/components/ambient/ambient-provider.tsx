"use client";

import gsap from "gsap";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type AmbientColors,
  DEFAULT_AMBIENT,
  sampleAmbient,
  toTriplet,
} from "@/lib/ambient-color";
import { cn } from "@/lib/utils";

/**
 * The room's light. One image at a time "lights" the app: it is drawn huge
 * and defocused behind everything (<AmbientField>), and two glow colours
 * sampled from it are written to `--amb` / `--amb-2` on <html>, so buttons,
 * focus rings, the brand mark and status dots all take its colour.
 *
 * Pages call `useAmbientImage(src)`; the light persists across navigation
 * until another page sets its own, so the room keeps the colour of the last
 * picture you looked at.
 */

/** Pre-computed glow colours ("R G B" triplets) for a known image. */
export type AmbientPreset = { amb: string; amb2: string };

type AmbientContextValue = {
  image: string | null;
  setImage: (src: string | null, preset?: AmbientPreset) => void;
};

const AmbientContext = createContext<AmbientContextValue | null>(null);

const COLOR_TWEEN_S = 0.9;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function applyColors(colors: AmbientColors | AmbientPreset, animate: boolean) {
  const root = document.documentElement;
  const amb = typeof colors.amb === "string" ? colors.amb : toTriplet(colors.amb);
  const amb2 = typeof colors.amb2 === "string" ? colors.amb2 : toTriplet(colors.amb2);
  gsap.killTweensOf(root, "--amb,--amb-2");
  if (!animate || prefersReducedMotion()) {
    root.style.setProperty("--amb", amb);
    root.style.setProperty("--amb-2", amb2);
    return;
  }
  // GSAP interpolates the numbers inside "R G B" strings.
  gsap.to(root, {
    "--amb": amb,
    "--amb-2": amb2,
    duration: COLOR_TWEEN_S,
    ease: "power2.out",
  });
}

export function AmbientProvider({ children }: { children: ReactNode }) {
  const [image, setImageState] = useState<string | null>(null);
  const requested = useRef<string | null>(null);

  const setImage = useCallback((src: string | null, preset?: AmbientPreset) => {
    if (requested.current === src) return;
    requested.current = src;
    setImageState(src);
    // Always fade: on first load this is the room "lighting up" with the
    // picture, in step with <AmbientField>'s cross-fade.
    const animate = true;
    if (!src) {
      applyColors(DEFAULT_AMBIENT, animate);
      return;
    }
    if (preset) {
      applyColors(preset, animate);
      return;
    }
    void sampleAmbient(src).then((colors) => {
      // A newer request may have landed while this one was sampling.
      if (requested.current !== src || !colors) return;
      applyColors(colors, animate);
    });
  }, []);

  const value = useMemo(() => ({ image, setImage }), [image, setImage]);
  return <AmbientContext.Provider value={value}>{children}</AmbientContext.Provider>;
}

// The light is decoration: outside a provider (isolated renders, tests)
// pages keep working in the default light instead of crashing.
const NO_AMBIENT: AmbientContextValue = { image: null, setImage: () => {} };

export function useAmbient() {
  return useContext(AmbientContext) ?? NO_AMBIENT;
}

/**
 * Light the room with `src` (null = the default light; undefined = leave
 * the current light alone, e.g. while data is still loading).
 */
export function useAmbientImage(src: string | null | undefined, preset?: AmbientPreset) {
  const { setImage } = useAmbient();
  const amb = preset?.amb;
  const amb2 = preset?.amb2;
  useEffect(() => {
    if (src === undefined) return;
    setImage(src, amb && amb2 ? { amb, amb2 } : undefined);
  }, [src, amb, amb2, setImage]);
}

/**
 * The room behind a page: a wall fading into a floor, hazed with the
 * ambient colour pair. Pure CSS on the --amb / --amb-2 / --haze variables,
 * so it re-lights in step with the GSAP colour tween in applyColors and
 * costs no image decode or blur (the old field drew the picture at 110px
 * blur, which was the most expensive layer on every page).
 *
 * `horizon` (0-100, % from the top) adds a floor: the wall meets it at a
 * soft hairline. Leave it out for app pages, where the room is all wall.
 */
export function AmbientField({
  className,
  horizon,
}: {
  className?: string;
  horizon?: number;
}) {
  const base =
    horizon === undefined
      ? "linear-gradient(var(--wall), var(--wall-2))"
      : `linear-gradient(var(--wall) 0, var(--wall-2) ${horizon}%, var(--floor) ${horizon}%, var(--floor-2) 100%)`;
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none fixed inset-0 z-0 overflow-hidden", className)}
      style={{ background: base }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: [
            // Key light: the picture's colour, upper right where work is shown.
            "radial-gradient(46% 52% at 72% 36%, rgb(var(--amb) / var(--haze)), transparent 70%)",
            // Fill: the second colour, smaller and higher.
            "radial-gradient(34% 38% at 96% 6%, rgb(var(--amb-2) / calc(var(--haze) * 0.55)), transparent 70%)",
            // A pale wash on the left wall keeps text areas calm.
            "radial-gradient(60% 46% at 18% 10%, var(--wall), transparent 70%)",
          ].join(", "),
        }}
      />
      {horizon !== undefined && (
        <>
          <div
            className="absolute inset-x-0 h-px"
            style={{
              top: `${horizon}%`,
              background: "linear-gradient(90deg, transparent, var(--line) 30%, var(--line) 80%, transparent)",
            }}
          />
          {/* Spill of the key light onto the floor. */}
          <div
            className="absolute inset-x-0 bottom-0"
            style={{
              top: `${horizon}%`,
              background:
                "radial-gradient(36% 40% at 72% 0%, rgb(var(--amb) / calc(var(--haze) * 0.6)), transparent 70%)",
            }}
          />
        </>
      )}
    </div>
  );
}
