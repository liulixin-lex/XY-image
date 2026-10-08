import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_SC } from "next/font/google";
import type { ReactNode } from "react";

import { BRAND } from "@/lib/brand";
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

// The display face (GGUU Display, from Smiley Sans / 得意黑) is self-hosted
// in unicode-range chunks: see src/app/display-font.css.

// Chinese text. Google serves it in unicode-range slices, so a page only
// downloads the glyphs it renders. Not preloaded on purpose.
const notoSc = Noto_Sans_SC({
  subsets: ["latin"],
  variable: "--font-noto-sc",
  display: "swap",
  preload: false,
});

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

export const viewport: Viewport = {
  themeColor: "#0a0f1e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={cn("dark", geist.variable, geistMono.variable, notoSc.variable)}
      suppressHydrationWarning
    >
      <body className="min-h-[100dvh] bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
