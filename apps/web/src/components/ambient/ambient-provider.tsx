"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
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
 * The room's light. One image at a time "lights" the app: two glow colours
 * sampled from it haze the wall behind everything (<AmbientField>) and are
 * written to `--amb` / `--amb-2` on <html>, so small accents (the poster's
 * colour slab, lit shadows) take its colour too.
 *
 * Pages call `useAmbientImage(src)`; the light persists across navigation
 * until another page sets its own, so the room keeps the colour of the last
 * picture you looked at.
 *
 * Performance: the change of light is a cross-fade of two composited layers
 * (opacity only). The variables on <html> switch in one step; tweening them
 * per frame, as before, re-styled every element of the page for 0.9 s on
 * each change of picture.
 */

/** Pre-computed glow colours ("R G B" triplets) for a known image. */
export type AmbientPreset = { amb: string; amb2: string };
type SetAmbientImage = (src: string | null, preset?: AmbientPreset) => void;

const DEFAULT_LIGHT: AmbientPreset = {
  amb: toTriplet(DEFAULT_AMBIENT.amb),
  amb2: toTriplet(DEFAULT_AMBIENT.amb2),
};

// Split so a change of light re-renders only the layers that paint it, not
// every page that sets an image.
const AmbientSetterContext = createContext<SetAmbientImage | null>(null);
const AmbientLightContext = createContext<AmbientPreset>(DEFAULT_LIGHT);

/** Matches the CSS `ambient-in` keyframes in globals.css. */
const FADE_MS = 900;

function toLight(colors: AmbientColors | AmbientPreset): AmbientPreset {
  return {
    amb: typeof colors.amb === "string" ? colors.amb : toTriplet(colors.amb),
    amb2: typeof colors.amb2 === "string" ? colors.amb2 : toTriplet(colors.amb2),
  };
}

export function AmbientProvider({ children }: { children: ReactNode }) {
  const [light, setLight] = useState<AmbientPreset>(DEFAULT_LIGHT);
  const requested = useRef<string | null>(null);

  const apply = useCallback((colors: AmbientColors | AmbientPreset) => {
    const next = toLight(colors);
    const root = document.documentElement;
    root.style.setProperty("--amb", next.amb);
    root.style.setProperty("--amb-2", next.amb2);
    setLight((prev) => (prev.amb === next.amb && prev.amb2 === next.amb2 ? prev : next));
  }, []);

  const setImage = useCallback<SetAmbientImage>(
    (src, preset) => {
      if (requested.current === src) return;
      requested.current = src;
      if (!src) {
        apply(DEFAULT_AMBIENT);
        return;
      }
      if (preset) {
        apply(preset);
        return;
      }
      void sampleAmbient(src).then((colors) => {
        // A newer request may have landed while this one was sampling.
        if (requested.current !== src || !colors) return;
        apply(colors);
      });
    },
    [apply],
  );

  return (
    <AmbientSetterContext.Provider value={setImage}>
      <AmbientLightContext.Provider value={light}>{children}</AmbientLightContext.Provider>
    </AmbientSetterContext.Provider>
  );
}

// The light is decoration: outside a provider (isolated renders, tests)
// pages keep working in the default light instead of crashing.
const NO_AMBIENT: SetAmbientImage = () => {};

/**
 * Light the room with `src` (null = the default light; undefined = leave
 * the current light alone, e.g. while data is still loading).
 */
export function useAmbientImage(src: string | null | undefined, preset?: AmbientPreset) {
  const setImage = useContext(AmbientSetterContext) ?? NO_AMBIENT;
  const amb = preset?.amb;
  const amb2 = preset?.amb2;
  useEffect(() => {
    if (src === undefined) return;
    setImage(src, amb && amb2 ? { amb, amb2 } : undefined);
  }, [src, amb, amb2, setImage]);
}

type LightLayer = { key: number; light: AmbientPreset };

/**
 * The current light as a stack of at most two layers: the incoming one
 * fades in over the outgoing one, which is dropped when the fade ends.
 * The first light shows without a fade, as does every change under
 * reduced motion.
 */
function useLightLayers() {
  const light = useContext(AmbientLightContext);
  const counter = useRef(0);
  const [layers, setLayers] = useState<LightLayer[]>(() => [{ key: 0, light }]);

  useEffect(() => {
    setLayers((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.light === light) return prev;
      counter.current += 1;
      const next = { key: counter.current, light };
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return [next];
      return [...prev.slice(-1), next];
    });
  }, [light]);

  // Settle on the incoming layer once its fade is over. A timer as well as
  // animationend: a hidden tab never fires the event.
  useEffect(() => {
    if (layers.length < 2) return;
    const timer = setTimeout(() => setLayers((prev) => prev.slice(-1)), FADE_MS + 100);
    return () => clearTimeout(timer);
  }, [layers]);

  return layers;
}

/**
 * A full-bleed wash painted from the light, cross-fading when it changes.
 * `paint` returns a CSS background for one light.
 */
export function AmbientWash({
  paint,
  className,
}: {
  paint: (light: AmbientPreset) => string;
  className?: string;
}) {
  const layers = useLightLayers();
  return (
    <>
      {layers.map((layer, index) => (
        <div
          key={layer.key}
          aria-hidden
          className={cn("absolute inset-0", index > 0 && "animate-ambient-in", className)}
          style={{ background: paint(layer.light) }}
        />
      ))}
    </>
  );
}

// Key light: the picture's colour, upper right where work is shown. Fill:
// the second colour, smaller and higher. A pale wash on the left wall keeps
// text areas calm.
const paintRoom = ({ amb, amb2 }: AmbientPreset) =>
  [
    `radial-gradient(46% 52% at 72% 36%, rgb(${amb} / var(--haze)), transparent 70%)`,
    `radial-gradient(34% 38% at 96% 6%, rgb(${amb2} / calc(var(--haze) * 0.55)), transparent 70%)`,
    "radial-gradient(60% 46% at 18% 10%, var(--wall), transparent 70%)",
  ].join(", ");
// Spill of the key light onto the floor.
const paintFloorSpill = ({ amb }: AmbientPreset) =>
  `radial-gradient(36% 40% at 72% 0%, rgb(${amb} / calc(var(--haze) * 0.6)), transparent 70%)`;

/**
 * The room behind a page: a wall fading into a floor, hazed with the
 * ambient colour pair. Pure CSS gradients (no image decode or blur: the old
 * field drew the picture at 110px blur, the most expensive layer on every
 * page); a change of light cross-fades two layers.
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
      <AmbientWash paint={paintRoom} />
      {horizon !== undefined && (
        <>
          <div
            className="absolute inset-x-0 h-px"
            style={{
              top: `${horizon}%`,
              background: "linear-gradient(90deg, transparent, var(--line) 30%, var(--line) 80%, transparent)",
            }}
          />
          <div className="absolute inset-x-0 bottom-0" style={{ top: `${horizon}%` }}>
            <AmbientWash paint={paintFloorSpill} />
          </div>
        </>
      )}
    </div>
  );
}
