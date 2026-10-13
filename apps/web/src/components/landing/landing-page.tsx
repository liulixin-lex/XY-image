"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AmbientField, useAmbientImage } from "@/components/ambient/ambient-provider";
import { BillingSection } from "@/components/landing/billing";
import { Closing } from "@/components/landing/closing";
import { GallerySection } from "@/components/landing/gallery";
import { Hero } from "@/components/landing/hero";
import { FeaturesSection, ModelsSection } from "@/components/landing/models";
import type { PromptBoxHandle } from "@/components/landing/prompt-box";
import { SHOWCASE_ITEMS, type ShowcaseItem } from "@/components/landing/showcase";
import { SiteNav } from "@/components/landing/site-nav";
import { useAuth } from "@/lib/auth-context";
import { getXy2apiWebUrl } from "@/lib/env";
import type { AspectRatio, ImageResolution } from "@/lib/image-model-meta";
import { fetchAuthConfig } from "@/lib/xy2api-api";

/** The sample `index` places along the list, wrapping (the list is never empty). */
const sampleAt = (index: number) => SHOWCASE_ITEMS[index % SHOWCASE_ITEMS.length] as ShowcaseItem;
const sample = (id: string) => SHOWCASE_ITEMS.find((item) => item.id === id) ?? sampleAt(0);
/**
 * Pictures in the feature cards, chosen to fit what each card shows: a
 * studio batch of four looks, a canvas board of one sci-fi set, and two
 * portraits for the 写实人像 template.
 */
const FEATURE_SAMPLES = [
  ...["silk-sky", "red-cloak", "ruby-crown", "neon-city"],
  ...["fog-mech", "mech-river", "desert-ark"],
  ...["amber-eyes", "film-portrait"],
].map(sample);
const BILLING_SAMPLE = sample("dawn-veil");
/** The two samples fanned out behind the one on show at the end of the page. */
function closingFan(selected: number): [ShowcaseItem, ShowcaseItem] {
  return [sampleAt(selected + 3), sampleAt(selected + 7)];
}

/**
 * Public landing page: the soft-poster room. The selected sample stands on
 * the floor as a slanted panel and colours the whole page (useAmbientImage
 * + <AmbientField>); the prompt box is real and hands its draft to the
 * studio after login.
 *
 * Main-site links come from the API's public config when it answers, with
 * the build-time URL as a fallback so the page never waits on the network.
 *
 * Motion (第 62 条; the user picked the coverflow gallery and the stacking
 * feature cards from recorded previews): see each section's component.
 */
export function LandingPage() {
  const fallback = getXy2apiWebUrl();
  const { user } = useAuth();
  const [registerUrl, setRegisterUrl] = useState<string | null>(
    fallback ? `${fallback}/register` : null,
  );

  const [selected, setSelected] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>("3:4");
  const [resolution, setResolution] = useState<ImageResolution>("2K");
  const promptBox = useRef<PromptBoxHandle>(null);
  const top = useRef<HTMLDivElement>(null);

  const current = SHOWCASE_ITEMS[selected] ?? SHOWCASE_ITEMS[0]!;
  useAmbientImage(current.large, { amb: current.amb, amb2: current.amb2 });

  useEffect(() => {
    let cancelled = false;
    fetchAuthConfig()
      .then((config) => {
        if (!cancelled && config.registerUrl) setRegisterUrl(config.registerUrl);
      })
      .catch(() => {
        // Keep the build-time fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const backToPrompt = useCallback(() => {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    top.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    // Focus after the scroll has started so the page does not jump twice.
    window.setTimeout(() => promptBox.current?.focus(), smooth ? 450 : 0);
  }, []);

  const copySample = useCallback(
    (index: number) => {
      const item = SHOWCASE_ITEMS[index];
      if (!item) return;
      setSelected(index);
      setPrompt(item.prompt);
      if (item.ratio === "4:3" || item.ratio === "3:4") setRatio(item.ratio);
      console.info("[landing] sample copied into prompt box", { id: item.id });
      backToPrompt();
    },
    [backToPrompt],
  );

  return (
    <div ref={top} className="relative min-h-[100dvh] overflow-x-clip bg-ground">
      <AmbientField />
      <SiteNav registerUrl={registerUrl} />
      <main>
        <Hero
          ref={promptBox}
          items={SHOWCASE_ITEMS}
          selected={selected}
          onSelect={setSelected}
          prompt={prompt}
          onPromptChange={setPrompt}
          ratio={ratio}
          onRatioChange={setRatio}
          resolution={resolution}
          onResolutionChange={setResolution}
        />
        <GallerySection items={SHOWCASE_ITEMS} onPreview={setSelected} onUseSample={copySample} />
        <FeaturesSection samples={FEATURE_SAMPLES} signedIn={Boolean(user)} />
        <ModelsSection />
        <BillingSection sample={BILLING_SAMPLE} />
      </main>
      <Closing
        registerUrl={registerUrl}
        mainSiteUrl={fallback}
        sample={current}
        fan={closingFan(selected)}
        onWrite={backToPrompt}
      />
    </div>
  );
}
