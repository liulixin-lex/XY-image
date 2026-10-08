"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { AmbientField } from "@/components/ambient/ambient-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { LoadingScreen } from "@/components/loading-screen";
import { useAuth } from "@/lib/auth-context";

/**
 * Signed-in shell: the room's light behind everything, a floating top
 * nav, and the page scrolling on the document. Pages set the light with
 * useAmbientImage(); pages that don't keep the last picture's colour.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?next=${next}`);
    }
  }, [loading, user, router]);

  if (loading) return <LoadingScreen />;
  if (!user) return null;

  return (
    <div className="relative isolate min-h-[100dvh] bg-ground">
      <AmbientField />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-[10px] focus:bg-fg focus:px-4 focus:py-2 focus:text-ground"
      >
        跳到主内容
      </a>
      <AppSidebar />
      <main id="main" className="relative z-10 pb-28 md:pb-16">
        {children}
      </main>
    </div>
  );
}
