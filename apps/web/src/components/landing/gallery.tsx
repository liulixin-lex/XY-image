"use client";

import { WandSparklesIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MOTION_OK, ScrollTrigger, gsap, useGSAP } from "@/lib/motion";

import { RevealHeading } from "./reveal-heading";
import { SAMPLE_ALT, type ShowcaseItem } from "./showcase";

/** Latitudes of the tile rows and how many tiles go round each row. */
const ROWS = [-34, -17, 0, 17, 34];
const SEGMENTS = 18;
/** Tilt limits while dragging (degrees). */
const TILT_MIN = -22;
const TILT_MAX = 18;

type Tile = {
  key: string;
  index: number;
  lat: number;
  lon: number;
  focusable: boolean;
};

/**
 * 从一张示例开始 (第 63 条; the user picked it from recorded previews):
 * the samples cover a globe that turns slowly in front of you (after React
 * Bits Dome Gallery). Drag it to spin it, with a short glide when you let
 * go; scrolling past turns it a quarter. Click (or Enter on) a picture and
 * it opens large in the middle with its title, the full description and
 * 「做同款」; Esc or the close button puts it back and returns focus to the
 * tile. The tile facing you re-lights the room.
 *
 * Every sample has exactly one focusable tile (the copy nearest the
 * equator); the globe turns to face whichever tile has focus, so keyboard
 * users see what they are on. All other copies are hidden from assistive
 * tech. The globe is CSS 3D (one transform on the globe per frame, never
 * per tile), it drifts only while on screen, never while held or while a
 * picture is open. Reduced motion: no drift and no scroll turn (dragging
 * still works). The drift stays on in the lite render tier: measured on
 * the GPU-less Mac in a real window, the page holds 60 fps with it.
 */
export function GallerySection({
  items,
  onPreview,
  onUseSample,
}: {
  items: ShowcaseItem[];
  /** Re-light the room with this sample. */
  onPreview: (index: number) => void;
  /** Copy the sample's description into the prompt box. */
  onUseSample: (index: number) => void;
}) {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const globe = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [front, setFront] = useState(0);
  /** True right after a drag, so letting go over a tile does not open it. */
  const dragged = useRef(false);
  /** The tile that opened the picture, to give focus back on close. */
  const opener = useRef<HTMLElement | null>(null);
  /** Turns the globe to face (lat, lon); set by the scene script. */
  const faceRef = useRef<((lat: number, lon: number) => void) | null>(null);

  const tiles = useMemo<Tile[]>(() => {
    const all = ROWS.flatMap((lat, row) =>
      Array.from({ length: SEGMENTS }, (_, col) => ({
        key: `${row}-${col}`,
        // Rows are staggered by half a tile, like brickwork.
        lon: (col * 360) / SEGMENTS + (row % 2 ? 180 / SEGMENTS : 0),
        lat,
        index: (row * 7 + col * 3) % items.length,
        focusable: false,
      })),
    );
    // One focusable copy per sample: the first found, equator rows first.
    const seen = new Set<number>();
    const byLatitude = [...all].sort(
      (a, b) => Math.abs(a.lat) - Math.abs(b.lat),
    );
    for (const tile of byLatitude) {
      if (seen.has(tile.index)) continue;
      seen.add(tile.index);
      tile.focusable = true;
    }
    return all;
  }, [items.length]);

  useGSAP(
    () => {
      const st = stage.current;
      const ball = globe.current;
      if (!st || !ball) return;
      const rot = { x: -4, y: 0, scroll: 0 };
      const middle = tiles.filter((tile) => tile.lat === 0);

      const layout = () => {
        // A globe larger than the stage, seen from two radii away: the
        // middle faces you and the edges curve off.
        const radius = Math.max(380, Math.min(980, st.clientWidth * 0.6));
        st.style.setProperty("--radius", `${radius.toFixed(0)}px`);
        // Square tiles that fit both the column and the row spacing, with a gap.
        const across = (2 * Math.PI * radius) / SEGMENTS;
        const down = (radius * 17 * Math.PI) / 180;
        st.style.setProperty(
          "--tile",
          `${(Math.min(across, down) * 0.88).toFixed(0)}px`,
        );
      };
      const apply = () => {
        const turn = rot.y + rot.scroll;
        ball.style.transform = `translateZ(calc(var(--radius) * -1)) rotateX(${rot.x.toFixed(2)}deg) rotateY(${turn.toFixed(2)}deg)`;
        // The equator tile straight ahead names the room colour.
        const facing = (((-turn % 360) + 360) % 360) / (360 / SEGMENTS);
        const ahead = middle[Math.round(facing) % SEGMENTS];
        if (ahead)
          setFront((prev) => (prev === ahead.index ? prev : ahead.index));
      };
      layout();
      apply();

      faceRef.current = (lat, lon) => {
        // Nearest equivalent angle, so the globe takes the short way round.
        const target = -lon - rot.scroll;
        const delta = ((((target - rot.y) % 360) + 540) % 360) - 180;
        gsap.to(rot, {
          y: rot.y + delta,
          x: gsap.utils.clamp(TILT_MIN, TILT_MAX, lat),
          duration: window.matchMedia(MOTION_OK).matches ? 0.6 : 0,
          ease: "power3.out",
          overwrite: true,
          onUpdate: apply,
        });
      };

      const onResize = () => {
        layout();
        apply();
      };
      window.addEventListener("resize", onResize);

      // Drag to spin; only a real drag takes the pointer, so a plain click
      // still reaches the tile. A short glide follows the release.
      type Drag = {
        x: number;
        y: number;
        rx: number;
        ry: number;
        vx: number;
        t: number;
        lastX: number;
        held: boolean;
      };
      let drag: Drag | null = null;
      let glide: gsap.core.Tween | null = null;
      const down = (event: PointerEvent) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if ((event.target as HTMLElement).closest("[data-detail]")) return;
        glide?.kill();
        const now = performance.now();
        drag = {
          x: event.clientX,
          y: event.clientY,
          rx: rot.x,
          ry: rot.y,
          vx: 0,
          t: now,
          lastX: event.clientX,
          held: false,
        };
      };
      const move = (event: PointerEvent) => {
        if (!drag) return;
        if (!drag.held) {
          if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6)
            return;
          drag.held = true;
          st.setPointerCapture(event.pointerId);
          st.dataset.dragging = "true";
        }
        rot.y = drag.ry + (event.clientX - drag.x) * 0.12;
        rot.x = gsap.utils.clamp(
          TILT_MIN,
          TILT_MAX,
          drag.rx - (event.clientY - drag.y) * 0.08,
        );
        const now = performance.now();
        drag.vx = (event.clientX - drag.lastX) / Math.max(1, now - drag.t);
        drag.lastX = event.clientX;
        drag.t = now;
        apply();
      };
      const up = () => {
        if (!drag) return;
        const { vx, held } = drag;
        dragged.current = held;
        // The click that follows a drag (same task) is ignored; clear after.
        window.setTimeout(() => {
          dragged.current = false;
        }, 0);
        drag = null;
        delete st.dataset.dragging;
        if (held && window.matchMedia(MOTION_OK).matches)
          glide = gsap.to(rot, {
            y: rot.y + vx * 260,
            duration: 1.2,
            ease: "power3.out",
            onUpdate: apply,
          });
      };
      st.addEventListener("pointerdown", down);
      st.addEventListener("pointermove", move);
      st.addEventListener("pointerup", up);
      st.addEventListener("pointercancel", up);

      // Drift only while the globe is on screen.
      let visible = false;
      const watch = ScrollTrigger.create({
        trigger: st,
        start: "top bottom",
        end: "bottom top",
        onToggle: (self) => {
          visible = self.isActive;
        },
      });
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const drift = (_time: number, delta: number) => {
          if (!visible || drag || st.dataset.open === "true") return;
          rot.y -= Math.min(delta, 50) * 0.0024;
          apply();
        };
        gsap.ticker.add(drift);
        gsap.to(rot, {
          scroll: -90,
          ease: "none",
          onUpdate: apply,
          scrollTrigger: {
            trigger: section.current,
            start: "top bottom",
            end: "bottom top",
            scrub: 0.6,
          },
        });
        console.info("[landing] sample globe", {
          tiles: tiles.length,
          samples: items.length,
        });
        return () => {
          gsap.ticker.remove(drift);
          rot.scroll = 0;
        };
      });
      return () => {
        mm.revert();
        watch.kill();
        glide?.kill();
        faceRef.current = null;
        window.removeEventListener("resize", onResize);
        st.removeEventListener("pointerdown", down);
        st.removeEventListener("pointermove", move);
        st.removeEventListener("pointerup", up);
        st.removeEventListener("pointercancel", up);
      };
    },
    { scope: section, dependencies: [tiles] },
  );

  // Re-light after the globe settles on a picture, so a spin stays calm.
  useEffect(() => {
    const timer = setTimeout(() => onPreview(open ?? front), 250);
    return () => clearTimeout(timer);
  }, [front, open, onPreview]);

  const close = useCallback(() => {
    setOpen(null);
    // Back to the tile that opened it (after the overlay is gone).
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  }, []);
  useEffect(() => {
    if (stage.current) stage.current.dataset.open = String(open !== null);
    if (open === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const detail = open === null ? null : items[open];

  return (
    <section
      ref={section}
      id="gallery"
      aria-labelledby="gallery-title"
      className="relative z-10 flex flex-col pt-24 lg:pt-32"
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-end justify-between gap-6 px-5 sm:px-8 lg:px-[clamp(24px,3.6vw,64px)]">
        <div>
          <RevealHeading
            id="gallery-title"
            className="font-display text-[clamp(44px,5vw,80px)] leading-[1.02] font-normal text-fg"
          >
            从一张<em className="text-acc not-italic">示例</em>开始
          </RevealHeading>
          <p className="mt-4 max-w-[34em] text-[16px] leading-relaxed text-fg-soft">
            拖动转一转，点一张看描述，再点「做同款」。
          </p>
        </div>
        <p
          aria-hidden
          className="numeral text-[clamp(40px,4.4vw,56px)] text-fg tabular"
        >
          {String((open ?? front) + 1).padStart(2, "0")}
          <span className="text-[0.42em] text-fg-muted">
            /{String(items.length).padStart(2, "0")}
          </span>
        </p>
      </div>
      <div
        ref={stage}
        className="relative mt-6 h-[min(92dvh,860px)] min-h-[520px] cursor-grab touch-pan-y overflow-hidden select-none data-[dragging=true]:cursor-grabbing"
      >
        {/* The globe fades out towards the stage's edges; an opened picture
            sits above this layer, so it is never faded. */}
        <div className="absolute inset-0 [perspective:calc(var(--radius,700px)*2)] [mask-image:radial-gradient(ellipse_72%_68%_at_50%_50%,#000_58%,transparent_100%)]">
          <div
            ref={globe}
            className="absolute top-1/2 left-1/2 [transform-style:preserve-3d]"
          >
            {tiles.map((tile) => {
              const item = items[tile.index];
              if (!item) return null;
              return (
                <button
                  key={tile.key}
                  type="button"
                  tabIndex={tile.focusable ? 0 : -1}
                  aria-hidden={tile.focusable ? undefined : true}
                  aria-label={
                    tile.focusable
                      ? `示例 ${tile.index + 1}：${item.title}，打开看描述`
                      : undefined
                  }
                  onFocus={() =>
                    tile.focusable && faceRef.current?.(tile.lat, tile.lon)
                  }
                  data-sample={tile.index}
                  onClick={() => {
                    if (dragged.current) return;
                    // Focus comes back to this sample's one focusable tile.
                    opener.current =
                      globe.current?.querySelector<HTMLElement>(
                        `[data-sample="${tile.index}"][tabindex="0"]`,
                      ) ?? null;
                    // Bring the whole stage into view so the picture opens on screen.
                    const box = stage.current?.getBoundingClientRect();
                    if (box && (box.top < 0 || box.bottom > window.innerHeight))
                      window.scrollBy({
                        top: box.top + box.height / 2 - window.innerHeight / 2,
                        behavior: window.matchMedia(MOTION_OK).matches
                          ? "smooth"
                          : "auto",
                      });
                    setOpen(tile.index);
                  }}
                  className="absolute top-[calc(var(--tile)/-2)] left-[calc(var(--tile)/-2)] size-[var(--tile)] overflow-hidden rounded-[14px] bg-panel shadow-[0_14px_28px_-18px_var(--shadow-2)] [backface-visibility:hidden] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-acc"
                  style={{
                    transform: `rotateY(${tile.lon}deg) rotateX(${-tile.lat}deg) translateZ(var(--radius))`,
                  }}
                >
                  {/* biome-ignore lint/performance/noImgElement: static export */}
                  <img
                    src={item.src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="pointer-events-none h-full w-full object-cover"
                    style={{ objectPosition: item.focus }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        {detail && open !== null ? (
          <div
            data-detail
            className="absolute inset-0 z-10 flex items-center justify-center bg-ground/45 p-5"
          >
            <SampleDetail
              item={detail}
              onClose={close}
              onUse={() => onUseSample(open)}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The opened picture: large, with its title, full description and 「做同款」. */
function SampleDetail({
  item,
  onClose,
  onUse,
}: { item: ShowcaseItem; onClose: () => void; onUse: () => void }) {
  const card = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
  }, []);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from(card.current, {
          scale: 0.86,
          opacity: 0,
          y: 24,
          duration: 0.55,
          ease: "power3.out",
        });
        gsap.from("[data-detail-line]", {
          y: 14,
          opacity: 0,
          stagger: 0.06,
          duration: 0.45,
          delay: 0.15,
          ease: "power3.out",
        });
      });
      return () => mm.revert();
    },
    { scope: card, dependencies: [item.id] },
  );
  return (
    // A non-modal <dialog> in the stage (open, not showModal): the page
    // around it stays usable; Esc and the close button put it away.
    <dialog
      ref={card}
      open
      aria-label={item.title}
      className="relative m-0 grid max-h-full w-[min(920px,100%)] grid-cols-1 overflow-hidden rounded-[24px] border-0 bg-panel p-0 text-fg shadow-[0_2px_4px_var(--shadow),0_60px_100px_-40px_var(--shadow-2)] md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
    >
      <div className="max-h-[40dvh] overflow-hidden md:max-h-none">
        {/* biome-ignore lint/performance/noImgElement: static export */}
        <img
          src={item.large}
          alt={`${SAMPLE_ALT}：${item.title}`}
          decoding="async"
          className="h-full w-full object-cover"
          style={{ objectPosition: item.focus }}
        />
      </div>
      <div className="relative flex min-h-0 flex-col gap-4 overflow-y-auto p-6 md:p-9">
        <button
          ref={closeButton}
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-tint/[0.08] hover:text-fg focus-visible:outline-2 focus-visible:outline-acc"
        >
          <XIcon className="size-4" />
        </button>
        <span
          data-detail-line
          className="poster-label text-[13px] text-fg-muted"
        >
          {SAMPLE_ALT} · {item.ratio} · 4K
        </span>
        <h3
          data-detail-line
          className="pr-8 font-display text-[clamp(26px,2.6vw,38px)] leading-tight text-fg"
        >
          {item.title}
        </h3>
        <p
          data-detail-line
          className="text-[14px] leading-relaxed text-fg-soft md:line-clamp-[9]"
        >
          {item.prompt}
        </p>
        <div data-detail-line className="mt-auto pt-2">
          <button
            type="button"
            onClick={onUse}
            className="sk inline-flex h-11 items-center rounded-[10px] bg-acc px-5 text-[15px] font-semibold text-acc-ink shadow-acc transition-[background-color,scale] hover:bg-acc-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:scale-[0.97]"
          >
            <span className="sk-in gap-1.5">
              <WandSparklesIcon className="size-4" strokeWidth={2} />
              做同款
            </span>
          </button>
        </div>
      </div>
    </dialog>
  );
}
