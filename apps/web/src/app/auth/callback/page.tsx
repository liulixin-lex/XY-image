"use client";

/**
 * Retired Supabase PKCE callback. Sign-in goes through the main site
 * (POST /api/auth/xy2api/login), and the self-hosted Nginx refuses PKCE
 * grants, so this page only sends old links and bookmarks to /login.
 * TODO: delete once `${web}/auth/callback` leaves GoTrue's
 * ADDITIONAL_REDIRECT_URLS (deploy/selfhost/prepare.mjs).
 */
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { LoadingScreen } from "../../../components/loading-screen";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login?reason=auth_callback_retired");
  }, [router]);

  return <LoadingScreen />;
}
