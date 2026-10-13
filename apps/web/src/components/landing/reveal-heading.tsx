"use client";

import { type ReactNode, useRef } from "react";

import { MOTION_OK, SplitText, gsap, useGSAP } from "@/lib/motion";

/**
 * A section heading whose characters rise into place from behind a mask the
 * first time it scrolls into view, staggered (React Bits Split / Masked Text;
 * anime.js splitText + stagger). SplitText keeps an aria-label with the whole
 * text and re-splits when fonts load; reduced motion leaves the heading as is.
 * The user picked it from recorded previews (第 62 条).
 */
export function RevealHeading({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const split = SplitText.create(el, {
          type: "chars",
          mask: "chars",
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.chars, {
              yPercent: 115,
              rotate: 4,
              duration: 1,
              ease: "expo.out",
              stagger: 0.04,
              scrollTrigger: { trigger: el, start: "top 86%", once: true },
            }),
        });
        return () => split.revert();
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <h2 ref={ref} id={id} className={className}>
      {children}
    </h2>
  );
}
