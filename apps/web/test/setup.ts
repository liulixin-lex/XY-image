/**
 * jsdom lacks matchMedia, which GSAP's matchMedia and useBreakpoint read.
 * Report "no match" so components take their default (desktop-less,
 * motion-allowed) branch.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
