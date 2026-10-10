"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AmbientField, useAmbientImage } from "@/components/ambient/ambient-provider";
import { BillingSection } from "@/components/landing/billing";
import { Closing } from "@/components/landing/closing";
import { GallerySection } from "@/components/landing/gallery";
import { Hero } from "@/components/landing/hero";
import { ModesSection } from "@/components/landing/models";
import type { PromptBoxHandle } from "@/components/landing/prompt-box";
import { SHOWCASE_ITEMS } from "@/components/landing/showcase";
import { SiteNav } from "@/components/landing/site-nav";
import { useAuth } from "@/lib/auth-context";
import { getXy2apiWebUrl } from "@/lib/env";
import type { AspectRatio, ImageResolution } from "@/lib/image-model-meta";
import { fetchAuthConfig } from "@/lib/xy2api-api";

/**
 * Public landing page: the soft-poster room. The selected sample stands on
 * the floor as a slanted panel and colours the whole page (useAmbientImage
 * + <AmbientField>); the prompt box is real and hands its draft to the
 * studio after login.
 *
 * Main-site links come from the API's public config when it answers, with
 * the build-time URL as a fallback so the page never waits on the network.
 */
export default function LandingPage() {
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
        <ModesSection samples={SHOWCASE_ITEMS.slice(5, 12)} signedIn={Boolean(user)} />
        <BillingSection sample={SHOWCASE_ITEMS[1]!} />
      </main>
      <Closing registerUrl={registerUrl} mainSiteUrl={fallback} sample={current} onWrite={backToPrompt} />
    </div>
  );
}
