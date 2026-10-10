import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { BRAND } from "@/lib/brand";
import { RENDER_TIER_BOOT_SCRIPT } from "@/lib/render-tier";
import { cn } from "@/lib/utils";

import { Providers } from "../components/providers";

import "./globals.css";

// Latin UI, figures and the wordmark.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

// Request ids, prices, timers: data, not decoration.
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

// Poster numerals: counts, balances, timers, indices. Variable, with the
// optical-size axis so big figures get the condensed display cut.
const bigShoulders = Big_Shoulders({
  subsets: ["latin"],
  variable: "--font-big-shoulders",
  display: "swap",
  axes: ["opsz"],
  // next/font has no fallback metrics for this family (the build logged
  // "Failed to find font override values"); no system face matches a
  // condensed numeral anyway, so skip the size-adjusted fallback.
  adjustFontFallback: false,
});

// The display face (GGUU Display = 优设标题黑) is self-hosted in
// unicode-range chunks: see src/app/display-font.css.

// Chinese body text uses the system's CJK face (苹方 on Apple, 微软雅黑 on
// Windows, Noto Sans CJK on Android and Linux): see --font-cjk in
// globals.css. A webfont here cost 0.5-1.1 MB per page and re-laid every
// paragraph out when its slices landed.

/** Latin plus every character the UI's own copy uses (see split-display-font.py). */
const DISPLAY_UI_FONT = "/fonts/display/display-ui.woff2";

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} · 一句话生成图片`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.tagline,
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: BRAND.name,
    description: BRAND.tagline,
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND.name,
    description: BRAND.tagline,
    images: ["/og-image.png"],
  },
};

// Matches --ground in globals.css for each theme (browser chrome tint).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f2f3" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1a22" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={cn(geist.variable, geistMono.variable, bigShoulders.variable)}
      suppressHydrationWarning
    >
      <head>
        {/* Headlines paint in the display face on first render, no chunk-by-chunk swap. */}
        <link rel="preload" href={DISPLAY_UI_FONT} as="font" type="font/woff2" crossOrigin="anonymous" />
        {/* Machines without a real GPU get the lite tier before first paint (lib/render-tier.ts). */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant boot script, no user input */}
        <script dangerouslySetInnerHTML={{ __html: RENDER_TIER_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-[100dvh] bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
