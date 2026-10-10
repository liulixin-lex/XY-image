"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { AccountProvider } from "../lib/account-context";
import { AmbientProvider } from "./ambient/ambient-provider";
import { AuthProvider } from "../lib/auth-context";
import { IssueProvider } from "./issues/issue-provider";
import { ToastProvider } from "./toast";

/**
 * Theme follows the system until the visitor picks one with <ThemeToggle>;
 * next-themes keeps that choice in localStorage ("theme", a preference, not
 * a credential) and sets `.dark` on <html> before paint, so there is no
 * flash. Transitions are suppressed during the swap so every surface flips
 * at once instead of fading at different speeds.
 */
export function Providers({ children }: { children: ReactNode }) {
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
