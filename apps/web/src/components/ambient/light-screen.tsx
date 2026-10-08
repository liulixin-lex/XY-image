"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP);

export type ScreenImage = {
  src: string;
  /** Optional `srcSet` (e.g. "a.webp 540w, b.webp 900w"). */
  srcSet?: string;
  alt: string;
  /** object-position for the crop. */
  focus?: string;
};

/**
 * The 氛围屏: one big picture hanging in the night room, turned away from
 * the viewer, with its reflection on the floor. A new picture "lights up"
 * (bright and soft, then settles) while the old one fades out. On devices
 * with a fine pointer the screen turns slightly toward the cursor.
 *
 * Motion is skipped under prefers-reduced-motion; the content is fully
 * visible without JavaScript (the tilt is plain CSS).
 */
export function LightScreen({
  image,
  tilt = -24,
  pitch = 2,
  interactive = true,
  reflection = true,
  sizes = "(min-width: 1024px) 56vw, 100vw",
  eager = false,
  className,
  frameClassName,
  children,
  onImageLoad,
}: {
  image: ScreenImage | null;
  /** rotateY in degrees (negative turns the right edge away). */
  tilt?: number;
  /** rotateX in degrees. */
  pitch?: number;
  interactive?: boolean;
  reflection?: boolean;
  sizes?: string;
  eager?: boolean;
  className?: string;
  frameClassName?: string;
  /** Overlays drawn on the screen plane (tags, status). */
  children?: ReactNode;
  onImageLoad?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const [layers, setLayers] = useState<{ key: number; image: ScreenImage | null }[]>(() => [
    { key: 0, image },
  ]);
  const counter = useRef(0);
  const dropOutgoing = useCallback(() => setLayers((prev) => prev.slice(-1)), []);

  // Keep at most two layers: the incoming picture over the outgoing one.
  useEffect(() => {
    setLayers((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.image?.src === image?.src) return prev;
      counter.current += 1;
      return [...prev.slice(-1), { key: counter.current, image }];
    });
  }, [image]);

  // Pointer tilt (fine pointers only, never with reduced motion).
  useGSAP(
    () => {
      const el = plane.current;
      if (!el || !interactive) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)", () => {
        const state = { ry: tilt, rx: pitch };
        const write = () => {
          el.style.setProperty("--ry", `${state.ry}deg`);
          el.style.setProperty("--rx", `${state.rx}deg`);
        };
        let frame = 0;
        const onMove = (event: PointerEvent) => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            const dx = event.clientX / window.innerWidth - 0.5;
            const dy = event.clientY / window.innerHeight - 0.5;
            gsap.to(state, {
              ry: tilt + dx * 7,
              rx: pitch - dy * 4,
              duration: 1.1,
              ease: "power3.out",
              overwrite: true,
              onUpdate: write,
            });
          });
        };
        window.addEventListener("pointermove", onMove, { passive: true });
        return () => {
          cancelAnimationFrame(frame);
          window.removeEventListener("pointermove", onMove);
        };
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [interactive, tilt, pitch] },
  );

  const current = layers[layers.length - 1]?.image ?? null;

  return (
    <div ref={root} className={cn("pointer-events-none", className)}>
      <div
        ref={plane}
        className="pointer-events-auto relative h-full w-full [transform-style:flat]"
        style={
          {
            "--ry": `${tilt}deg`,
            "--rx": `${pitch}deg`,
            transform: "perspective(1600px) rotateY(var(--ry)) rotateX(var(--rx))",
            transformOrigin: "0% 50%",
          } as React.CSSProperties
        }
      >
        <div
          className={cn(
            "relative h-full w-full overflow-hidden rounded-[22px] bg-well shadow-lit",
            frameClassName,
          )}
        >
          {layers.map((layer, index) => (
            <ScreenLayer
              key={layer.key}
              image={layer.image}
              incoming={index === layers.length - 1 && layers.length > 1}
              outgoing={index < layers.length - 1}
              sizes={sizes}
              eager={eager}
              onLoad={index === layers.length - 1 ? onImageLoad : undefined}
              onOutgoingDone={dropOutgoing}
            />
          ))}
          {/* Glass sheen: light catching the near edge of the screen. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgb(255_255_255/0.10),transparent_32%)]"
          />
          {children}
        </div>
        {reflection && current ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-[calc(100%+10px)] left-0 h-full w-full overflow-hidden rounded-[22px] opacity-[0.26] [mask-image:linear-gradient(to_bottom,transparent_62%,black)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_62%,black)]"
            style={{ transform: "scaleY(-1)" }}
          >
            {/* biome-ignore lint/performance/noImgElement: decorative reflection */}
            <img
              src={current.src}
              alt=""
              className="h-full w-full object-cover blur-[2px] transition-opacity duration-700"
              style={{ objectPosition: current.focus ?? "50% 40%" }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ScreenLayer({
  image,
  incoming,
  outgoing,
  sizes,
  eager,
  onLoad,
  onOutgoingDone,
}: {
  image: ScreenImage | null;
  incoming: boolean;
  outgoing: boolean;
  sizes: string;
  eager: boolean;
  onLoad?: (() => void) | undefined;
  onOutgoingDone: () => void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  // A static-export page can finish loading the image before hydration.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);

  // Incoming: light up (bright and soft, then settle). Waits for the pixels.
  useGSAP(
    () => {
      const img = ref.current;
      if (!img || !incoming || !loaded) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          img,
          { opacity: 0, scale: 1.05, filter: "brightness(1.7) blur(14px) saturate(1.3)" },
          {
            opacity: 1,
            scale: 1,
            filter: "brightness(1) blur(0px) saturate(1)",
            duration: 1.1,
            ease: "expo.out",
            clearProps: "filter,transform",
          },
        );
      });
      return () => mm.revert();
    },
    { dependencies: [incoming, loaded] },
  );

  // Outgoing: fade, then let the parent drop the layer.
  useEffect(() => {
    if (!outgoing) return;
    const timer = setTimeout(onOutgoingDone, 900);
    return () => clearTimeout(timer);
  }, [outgoing, onOutgoingDone]);

  if (!image) return null;
  return (
    // biome-ignore lint/performance/noImgElement: static export, no next/image optimizer
    <img
      ref={ref}
      src={image.src}
      srcSet={image.srcSet}
      sizes={image.srcSet ? sizes : undefined}
      alt={outgoing ? "" : image.alt}
      aria-hidden={outgoing || undefined}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => {
        setLoaded(true);
        onLoad?.();
      }}
      className={cn(
        "absolute inset-0 h-full w-full object-cover",
        // GSAP drives the incoming layer; CSS fades the first and outgoing ones.
        !incoming && "transition-opacity duration-700 ease-out",
        outgoing ? "opacity-0" : loaded ? "opacity-100" : "opacity-0",
      )}
      style={{ objectPosition: image.focus ?? "50% 40%" }}
    />
  );
}
