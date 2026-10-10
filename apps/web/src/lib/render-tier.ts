/**
 * Render tier: "lite" on machines that composite in software or through a
 * virtual GPU, "full" everywhere else.
 *
 * Why: backdrop blur (frosted header, popovers, canvas toolbars) is cheap on
 * a real GPU but not without one. Measured on a software compositor, the
 * frosted top bar alone was ~60% of the compositing work of a page scroll.
 * Lite turns every backdrop blur off and makes those surfaces opaque
 * (globals.css, `:root[data-render="lite"]`); layout and colours stay.
 *
 * The tier is detected once, off the critical path, and cached in
 * localStorage so the next page load applies it before first paint (inline
 * script in the root layout). A stored "full" is re-checked at most daily.
 */

export type RenderTier = "lite" | "full";

const STORAGE_KEY = "xy-render-tier";
const RECHECK_MS = 24 * 60 * 60 * 1000;

// Renderers that mean software rasterisation or a hypervisor's GPU.
const LITE_RENDERER =
  /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|paravirtual|virtualbox|vmware|svga3d|parallels|qxl|virgl|offscreen/i;

/** Inline, before first paint: apply a tier detected on an earlier visit. */
export const RENDER_TIER_BOOT_SCRIPT = `try{var t=JSON.parse(localStorage.getItem("${STORAGE_KEY}")||"null");if(t&&t.tier==="lite")document.documentElement.dataset.render="lite"}catch(e){}`;

function readRenderer(): { tier: RenderTier; renderer: string } {
  const canvas = document.createElement("canvas");
  // Browsers return null here when WebGL would run without hardware help.
  const fast = canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
  const gl = fast ?? canvas.getContext("webgl");
  if (!gl) return { tier: "lite", renderer: "no webgl" };
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(
    (info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "",
  );
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  if (!fast) return { tier: "lite", renderer: `${renderer} (performance caveat)` };
  return { tier: LITE_RENDERER.test(renderer) ? "lite" : "full", renderer };
}

function applyTier(tier: RenderTier) {
  if (tier === "lite") document.documentElement.dataset.render = "lite";
  else delete document.documentElement.dataset.render;
}

/** Detect (or reuse a recent detection) and apply. Safe to call more than once. */
export function settleRenderTier() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as {
      tier?: RenderTier;
      at?: number;
    } | null;
    if (stored?.tier === "lite" || (stored?.tier === "full" && Date.now() - (stored.at ?? 0) < RECHECK_MS)) {
      applyTier(stored.tier);
      return;
    }
  } catch {
    // Unreadable entry: detect again below.
  }
  try {
    const { tier, renderer } = readRenderer();
    applyTier(tier);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tier, at: Date.now() }));
    console.info(`[render] tier ${tier}`, { renderer });
  } catch (error) {
    console.info("[render] tier detection failed; keeping full effects", error);
  }
}
