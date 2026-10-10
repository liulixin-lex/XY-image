"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP);

export type StageImage = {
  src: string;
  /** Optional `srcSet` (e.g. "a.webp 540w, b.webp 900w"). */
  srcSet?: string;
  alt: string;
  /** object-position for the crop. */
  focus?: string;
};

/**
 * The poster stage: the picture on show stands on the floor of the room as
 * a slanted panel, with a slab of its own colour behind it, two other
 * pictures out of focus further back, a contact shadow and a faint
 * reflection. Coordinates come from the approved F2 comp (a 740×640 box),
 * expressed as percentages so the group scales with its height.
 *
 * Changing `image` wipes the new picture in along the slant (the page's one
 * authored motion); the room colour follows through <AmbientProvider>. On
 * fine pointers the layers drift at different depths. Both are skipped
 * under prefers-reduced-motion; without JavaScript everything is visible.
 */
export function PosterStage({
  image,
  far,
  sizes = "(min-width: 1024px) 34vw, 80vw",
  eager = false,
  className,
  children,
}: {
  image: StageImage;
  /** Two pictures shown out of focus behind the main one. */
  far?: [StageImage, StageImage];
  sizes?: string;
  eager?: boolean;
  className?: string;
  /** Stickers and captions placed on the stage (absolute, % of the box). */
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);

  // Depth drift: far panels move most, the main panel least.
  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)", () => {
        const layers = gsap.utils.toArray<HTMLElement>("[data-depth]", el);
        const movers = layers.map((layer) => {
          const depth = Number(layer.dataset.depth ?? 0);
          return {
            depth,
            x: gsap.quickTo(layer, "x", { duration: 1.2, ease: "power3.out" }),
            y: gsap.quickTo(layer, "y", { duration: 1.2, ease: "power3.out" }),
          };
        });
        let frame = 0;
        const onMove = (event: PointerEvent) => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            const dx = event.clientX / window.innerWidth - 0.5;
            const dy = event.clientY / window.innerHeight - 0.5;
            for (const mover of movers) {
              mover.x(dx * mover.depth * -26);
              mover.y(dy * mover.depth * -14);
            }
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
    { scope: root },
  );

  return (
    <div ref={root} className={cn("relative", className)}>
      {far ? (
        <>
          <FarPanel image={far[0]} depth={1} className="top-[17.2%] left-0 h-[46.9%] w-[27%] opacity-60 blur-[2.5px]" />
          <FarPanel image={far[1]} depth={1.3} className="top-[11.6%] left-[80.5%] h-[35.9%] w-[20.3%] opacity-50 blur-[3.5px]" />
        </>
      ) : null}

      {/* Contact shadow where the panel meets the floor. */}
      <div
        aria-hidden
        className="absolute top-[95%] left-[4%] h-[7%] w-[84%] bg-[radial-gradient(50%_50%_at_50%_50%,var(--shadow-2),transparent_70%)] blur-[6px]"
      />
      {/* Slab of the picture's own colour, offset behind it. */}
      <div aria-hidden data-depth="0.45" className="absolute top-[5.3%] left-[17.6%] h-[94.4%] w-[67.6%]">
        <div className="sk h-full w-full rounded-[26px] bg-[rgb(var(--amb)/0.5)]" />
      </div>
      <MainPanel image={image} sizes={sizes} eager={eager} />
      <Reflection image={image} />
      {children}
    </div>
  );
}

function FarPanel({
  image,
  depth,
  className,
}: {
  image: StageImage;
  depth: number;
  className: string;
}) {
  return (
    <div aria-hidden data-depth={depth} className={cn("absolute", className)}>
      <div className="sk-frame h-full w-full rounded-[22px]">
        {/* biome-ignore lint/performance/noImgElement: static export */}
        <img
          src={image.src}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-opacity duration-700"
          style={{ objectPosition: image.focus ?? "50% 40%" }}
        />
      </div>
    </div>
  );
}

type Layer = { key: number; image: StageImage };

function MainPanel({ image, sizes, eager }: { image: StageImage; sizes: string; eager: boolean }) {
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: 0, image }]);
  const counter = useRef(0);
  const dropOutgoing = useCallback(() => setLayers((prev) => prev.slice(-1)), []);

  // Keep at most two layers: the incoming picture over the outgoing one.
  useEffect(() => {
    setLayers((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.image.src === image.src) return prev;
      counter.current += 1;
      return [...prev.slice(-1), { key: counter.current, image }];
    });
  }, [image]);

  // The depth wrapper carries GSAP's translate; the slant lives on the frame
  // inside it, so the two transforms never fight.
  return (
    <div data-depth="0.25" className="absolute top-[1.25%] left-[13.5%] h-[96.6%] w-[67.6%]">
      <div className="sk shadow-lit relative h-full w-full overflow-hidden rounded-[26px] bg-well">
        {layers.map((layer, index) => (
          <PanelLayer
            key={layer.key}
            image={layer.image}
            incoming={index === layers.length - 1 && layers.length > 1}
            outgoing={index < layers.length - 1}
            sizes={sizes}
            eager={eager}
            onOutgoingDone={dropOutgoing}
          />
        ))}
      </div>
    </div>
  );
}

function PanelLayer({
  image,
  incoming,
  outgoing,
  sizes,
  eager,
  onOutgoingDone,
}: {
  image: StageImage;
  incoming: boolean;
  outgoing: boolean;
  sizes: string;
  eager: boolean;
  onOutgoingDone: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  // A static-export page can finish loading the image before hydration.
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, []);

  // Incoming: wipe in along the slant once the pixels are ready.
  useGSAP(
    () => {
      const el = wrap.current;
      if (!el || !incoming || !loaded) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          el,
          { clipPath: "polygon(100% 0, 100% 0, 100% 100%, 100% 100%)" },
          {
            clipPath: "polygon(0% 0, 100% 0, 100% 100%, 0% 100%)",
            duration: 0.9,
            ease: "expo.out",
            clearProps: "clipPath",
          },
        );
        gsap.fromTo(el, { scale: 1.08 }, { scale: 1, duration: 1.2, ease: "expo.out", clearProps: "transform" });
      });
      return () => mm.revert();
    },
    { dependencies: [incoming, loaded] },
  );

  // Outgoing: stays under the wipe, then the parent drops it.
  useEffect(() => {
    if (!outgoing) return;
    const timer = setTimeout(onOutgoingDone, 1000);
    return () => clearTimeout(timer);
  }, [outgoing, onOutgoingDone]);

  return (
    <div
      ref={wrap}
      className={cn(
        "absolute inset-0",
        // Before the incoming layer's pixels arrive it stays transparent.
        incoming && !loaded && "opacity-0",
      )}
    >
      {/* The picture is counter-skewed and overscanned to fill the slanted frame. */}
      {/* biome-ignore lint/performance/noImgElement: static export, no next/image optimizer */}
      <img
        ref={img}
        src={image.src}
        srcSet={image.srcSet}
        sizes={image.srcSet ? sizes : undefined}
        alt={outgoing ? "" : image.alt}
        aria-hidden={outgoing || undefined}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        className="absolute inset-y-0 -left-[12%] h-full w-[124%] max-w-none skew-x-[10deg] object-cover"
        style={{ objectPosition: image.focus ?? "50% 40%" }}
      />
    </div>
  );
}

/**
 * Faint mirror image on the floor, fading out. The picture is flipped about
 * its centre, so its bottom edge sits at the top of this strip.
 */
function Reflection({ image }: { image: StageImage }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-[100.6%] left-[13.5%] h-[23%] w-[67.6%] skew-x-[10deg] overflow-hidden rounded-[26px] opacity-[0.16] [mask-image:linear-gradient(black,transparent_85%)] [-webkit-mask-image:linear-gradient(black,transparent_85%)]"
    >
      {/* biome-ignore lint/performance/noImgElement: decorative reflection */}
      <img
        src={image.src}
        alt=""
        className="absolute top-0 left-0 h-[420%] w-full max-w-none -scale-y-100 object-cover blur-[3px]"
        style={{ objectPosition: image.focus ?? "50% 30%" }}
      />
    </div>
  );
}
