"use client";

import { ThemeProvider } from "next-themes";
import { type ReactNode, useEffect } from "react";

import { AccountProvider } from "../lib/account-context";
import { AmbientProvider } from "./ambient/ambient-provider";
import { AuthProvider } from "../lib/auth-context";
import { IssueProvider } from "./issues/issue-provider";
import { settleRenderTier } from "../lib/render-tier";
import { ToastProvider } from "./toast";

/**
 * Theme follows the system until the visitor picks one with <ThemeToggle>;
 * next-themes keeps that choice in localStorage ("theme", a preference, not
 * a credential) and sets `.dark` on <html> before paint, so there is no
 * flash. Transitions are suppressed during the swap so every surface flips
 * at once instead of fading at different speeds.
 */
export function Providers({ children }: { children: ReactNode }) {
  // Pick the render tier once the page is idle (a WebGL probe, ~10 ms).
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => settleRenderTier());
    return () => cancel(handle);
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <AccountProvider>
          <ToastProvider>
            <IssueProvider>
              <AmbientProvider>{children}</AmbientProvider>
            </IssueProvider>
          </ToastProvider>
        </AccountProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
