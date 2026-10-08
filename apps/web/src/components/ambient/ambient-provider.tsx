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

type Layer = { key: number; src: string | null; visible: boolean };

/**
 * The defocused image field behind a page. Cross-fades when the lighting
 * image changes. Fixed to the viewport by default; pass `className` to
 * position it inside a section instead.
 */
export function AmbientField({
  className,
  intensity = 0.62,
  vignette = "radial-gradient(90% 90% at 70% 35%, transparent, rgb(6 9 18 / 0.55) 60%, var(--ground-deep))",
  imageClassName,
}: {
  className?: string;
  /** Opacity of the image field (0-1). */
  intensity?: number;
  vignette?: string;
  /** Position/size of the blurred image inside the field. */
  imageClassName?: string;
}) {
  const { image } = useAmbient();
  const counter = useRef(0);
  const [layers, setLayers] = useState<Layer[]>(() => [
    { key: 0, src: image, visible: true },
  ]);

  useEffect(() => {
    setLayers((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.src === image) return prev;
      counter.current += 1;
      return [
        ...prev.slice(-1).map((layer) => ({ ...layer, visible: false })),
        { key: counter.current, src: image, visible: false },
      ];
    });
    // Next frame: fade the new layer in (the old one fades out together).
    const raf = requestAnimationFrame(() =>
      setLayers((prev) =>
        prev.map((layer, index) =>
          index === prev.length - 1 ? { ...layer, visible: true } : layer,
        ),
      ),
    );
    const cleanup = setTimeout(
      () => setLayers((prev) => prev.slice(-1)),
      1200,
    );
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(cleanup);
    };
  }, [image]);

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none fixed inset-0 z-0 overflow-hidden", className)}
    >
      <div className="absolute inset-0 bg-ground" />
      {layers.map((layer) => (
        <div
          key={layer.key}
          className="absolute inset-[-20%] transition-opacity duration-1000 ease-out motion-reduce:transition-none"
          style={{ opacity: layer.visible ? intensity : 0 }}
        >
          {layer.src ? (
            // biome-ignore lint/performance/noImgElement: decorative blurred field
            <img
              src={layer.src}
              alt=""
              decoding="async"
              className={cn(
                "absolute top-0 left-[40%] h-[90%] w-[80%] object-cover blur-[110px] saturate-[1.7]",
                imageClassName,
              )}
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(40% 45% at 72% 30%, rgb(var(--amb) / 0.32), transparent 70%), radial-gradient(35% 40% at 25% 75%, rgb(var(--amb-2) / 0.22), transparent 70%)",
              }}
            />
          )}
        </div>
      ))}
      <div className="absolute inset-0" style={{ background: vignette }} />
      <div className="grain-overlay absolute inset-0" />
    </div>
  );
}
