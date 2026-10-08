"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP);

/**
 * A result "lighting up": the picture arrives bright and soft, then settles
 * into true colour and focus. Runs once, only when `reveal` is true and the
 * image actually loaded; reduced motion shows the final image directly.
 */
export function RevealImage({
  src,
  alt,
  reveal = false,
  delay = 0,
  duration = 1.6,
  className,
  imgClassName,
  onRevealed,
  loading = "lazy",
}: {
  src: string;
  alt: string;
  reveal?: boolean;
  delay?: number;
  duration?: number;
  className?: string;
  imgClassName?: string;
  onRevealed?: (() => void) | undefined;
  loading?: "lazy" | "eager";
}) {
  const scope = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  const handleLoad = useCallback(() => setLoaded(true), []);

  // On prerendered pages the browser can finish loading the image before
  // React hydrates and attaches onLoad; that event is then lost and the frame
  // would stay invisible. Pick up an already-complete image on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, [src]);

  useGSAP(
    () => {
      const img = imgRef.current;
      if (!img || !loaded || !reveal) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const state = { p: 0 };
        const apply = () => {
          const p = state.p;
          // Light curve: brightness and blur fall, colour settles.
          img.style.filter = `brightness(${1.7 - 0.7 * p}) saturate(${1.3 - 0.3 * p}) blur(${(1 - p) * 12}px)`;
          img.style.transform = `scale(${1.05 - 0.05 * p})`;
          img.style.opacity = String(Math.min(1, p * 2.2));
        };
        apply();
        gsap.to(state, {
          p: 1,
          duration,
          delay,
          ease: "expo.out",
          onUpdate: apply,
          onComplete: () => {
            img.style.filter = "";
            img.style.transform = "";
            img.style.opacity = "";
            onRevealed?.();
          },
        });
      });
      return () => mm.revert();
    },
    { scope, dependencies: [loaded, reveal, src] },
  );

  return (
    <div ref={scope} className={cn("relative overflow-hidden bg-white/[0.04]", className)}>
      {/* biome-ignore lint/a11y/useAltText: alt is provided by the caller */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        onLoad={handleLoad}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
          imgClassName,
        )}
      />
    </div>
  );
}
