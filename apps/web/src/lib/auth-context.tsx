"use client";

import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AUTH_EXPIRED_EVENT } from "./server-api";
import { getSupabaseBrowserClient } from "./supabase-browser";
import { logoutXy2api } from "./xy2api-api";

/**
 * Session layer. The Supabase session is the only credential the browser
 * keeps; it belongs to a shadow user linked to the xy2api account.
 *
 * NOTE: `user.email` is a synthetic address (u<id>@<sso domain>). Never show
 * it; read the real email from `useAccount()` instead.
 */
interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** Revoke the main-site integration session (best effort), then sign out locally. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Where an expired session lands. Kept here so every surface agrees. */
export const EXPIRED_LOGIN_PATH = "/login?reason=expired";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  // Guards against the expiry handler and an explicit sign-out racing, and
  // against several parallel 401s triggering several redirects.
  const signingOutRef = useRef(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
      if (newSession) signingOutRef.current = false;
    });

    return () => subscription.unsubscribe();
  }, []);

  // Session expired on the server (401 from a protected endpoint, or the
  // WebSocket closed with 4001). Clear locally without calling the backend
  // logout (the server already rejected the token) and go to login once.
  useEffect(() => {
    const onExpired = () => {
      if (signingOutRef.current) return;
      signingOutRef.current = true;
      console.warn("[auth] session expired, returning to login");
      const supabase = getSupabaseBrowserClient();
      void Promise.resolve(supabase.auth.signOut({ scope: "local" }))
        .catch((error: unknown) => {
          console.warn("[auth] local sign-out failed", error);
        })
        .finally(() => {
          setSession(null);
          setUser(null);
          if (!window.location.pathname.startsWith("/login")) {
            window.location.assign(EXPIRED_LOGIN_PATH);
          }
        });
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const signOut = useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    const token = sessionRef.current?.access_token;
    if (token) await logoutXy2api(token);
    const supabase = getSupabaseBrowserClient();
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.warn("[auth] sign-out failed; clearing local state anyway", error);
    }
    setSession(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, session, loading, signOut }),
    [user, session, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
