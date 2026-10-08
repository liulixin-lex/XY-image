"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { AccountProvider } from "../lib/account-context";
import { AmbientProvider } from "./ambient/ambient-provider";
import { AuthProvider } from "../lib/auth-context";
import { IssueProvider } from "./issues/issue-provider";
import { ToastProvider } from "./toast";

/**
 * Dark-only on purpose: the 夜色光场 world is a night room lit by the image
 * on show. The canvas (Excalidraw) follows the same theme via next-themes.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" forcedTheme="dark" enableSystem={false}>
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
