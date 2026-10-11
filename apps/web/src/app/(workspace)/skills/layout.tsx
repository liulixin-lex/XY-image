import type { Metadata } from "next";
import type { ReactNode } from "react";

// Per-page tab title (FINDINGS W1); the root layout adds " · GGUU AI IMAGE".
export const metadata: Metadata = { title: "技能" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
