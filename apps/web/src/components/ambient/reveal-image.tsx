"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A result "lighting up": the picture arrives bright and soft, then settles
 * into true colour and focus. Runs once, only when `reveal` is true and the
 * image actually loaded; reduced motion shows the final image directly.
 *
 * The animation is the CSS `reveal-light` keyframes (globals.css): filter,
 * transform and opacity run on the compositor, so four pictures landing at
 * once do not compete with typing or scrolling on the main thread.
 */
export function RevealImage({
  src,
  alt,
  reveal = false,
  className,
  imgClassName,
  onRevealed,
  loading = "lazy",
}: {
  src: string;
  alt: string;
  reveal?: boolean;
  className?: string;
  imgClassName?: string;
  onRevealed?: (() => void) | undefined;
  loading?: "lazy" | "eager";
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  // The reveal plays once per picture, even if the parent keeps `reveal` on.
  const [played, setPlayed] = useState(false);

  const handleLoad = useCallback(() => setLoaded(true), []);

  // On prerendered pages the browser can finish loading the image before
  // React hydrates and attaches onLoad; that event is then lost and the frame
  // would stay invisible. Pick up an already-complete image on mount.
  useEffect(() => {
    setPlayed(false);
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, [src]);

  const revealing = reveal && loaded && !played;

  return (
    <div className={cn("relative overflow-hidden bg-tint/[0.04]", className)}>
      {/* biome-ignore lint/a11y/useAltText: alt is provided by the caller */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        onLoad={handleLoad}
        onAnimationEnd={(event) => {
          if (event.animationName !== "reveal-light") return;
          setPlayed(true);
          onRevealed?.();
        }}
        className={cn(
          "h-full w-full object-cover",
          revealing ? "animate-reveal" : "transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
          imgClassName,
        )}
      />
    </div>
  );
}
