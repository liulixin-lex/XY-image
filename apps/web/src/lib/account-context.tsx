"use client";

/**
 * Account state shared by every signed-in surface: main-site identity, USD
 * balance, synced keys, the models those keys unlock, and the public login
 * config (egress IP, main-site links).
 *
 * Refresh policy (docs/XY2API_FRONTEND_HANDOFF.md):
 * - account/balance: on sign-in, when the tab becomes visible again, and
 *   after each generation settles (immediately, then once more after the
 *   server's 15 s balance cache expires);
 * - models: lazily on first use, and again after the selected key changes;
 * - keys: on demand (settings) and after a sync.
 */
import type { ModelInfo } from "@loomic/shared";
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

import { useAuth } from "./auth-context";
import { issueCodeOf } from "./generation-errors";
import {
  type ImageModelInfo,
  fetchImageModels,
  fetchModels,
} from "./server-api";
import {
  type AccountPreferences,
  type AccountResponse,
  type AuthConfig,
  type KeyMetadata,
  type PreferencesPatch,
  fetchAccount,
  fetchAccountKeys,
  fetchAuthConfig,
  syncAccountKeys,
  updateAccountPreferences,
} from "./xy2api-api";

type Slot<T> = {
  data: T | null;
  loading: boolean;
  /** Stable error code (`key_unavailable`, `xy2api_unavailable`, ...). */
  error: string | null;
};

const empty = <T,>(): Slot<T> => ({ data: null, loading: false, error: null });

interface AccountContextValue {
  account: Slot<AccountResponse>;
  keys: Slot<KeyMetadata[]>;
  imageModels: Slot<ImageModelInfo[]>;
  chatModels: Slot<ModelInfo[]>;
  config: AuthConfig | null;
  refreshAccount: (options?: { force?: boolean }) => Promise<void>;
  refreshKeys: () => Promise<void>;
  ensureImageModels: () => void;
  refreshImageModels: () => Promise<void>;
  ensureChatModels: () => void;
  refreshChatModels: () => Promise<void>;
  /** Re-sync keys from the main site, then reload everything that depends on them. */
  syncKeys: () => Promise<void>;
  /** Send only changed fields. Throws ApiApplicationError on rejection. */
  updatePreferences: (patch: PreferencesPatch) => Promise<AccountPreferences>;
  /** Call when a generation finished (any outcome) so the balance catches up. */
  notifyGenerationSettled: () => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

/** Minimum gap between automatic balance refreshes. */
const AUTO_REFRESH_GAP_MS = 10_000;
/** The API caches usage for 15 s; read once more after it expires. */
const BALANCE_CACHE_MS = 16_000;

export function AccountProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const userId = session?.user.id ?? null;

  const [account, setAccount] = useState<Slot<AccountResponse>>(empty);
  const [keys, setKeys] = useState<Slot<KeyMetadata[]>>(empty);
  const [imageModels, setImageModels] = useState<Slot<ImageModelInfo[]>>(empty);
  const [chatModels, setChatModels] = useState<Slot<ModelInfo[]>>(empty);
  const [config, setConfig] = useState<AuthConfig | null>(null);

  const lastAccountFetch = useRef(0);
  const followUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageModelsRequested = useRef(false);
  const chatModelsRequested = useRef(false);

  // Reset everything when the signed-in user changes or signs out.
  useEffect(() => {
    setAccount(empty());
    setKeys(empty());
    setImageModels(empty());
    setChatModels(empty());
    imageModelsRequested.current = false;
    chatModelsRequested.current = false;
    lastAccountFetch.current = 0;
  }, [userId]);

  const refreshAccount = useCallback(async (options?: { force?: boolean }) => {
    const current = tokenRef.current;
    if (!current) return;
    const now = Date.now();
    if (!options?.force && now - lastAccountFetch.current < AUTO_REFRESH_GAP_MS)
      return;
    lastAccountFetch.current = now;
    setAccount((prev) => ({ ...prev, loading: true }));
    try {
      const data = await fetchAccount(current);
      setAccount({ data, loading: false, error: null });
    } catch (error) {
      console.warn("[account] refresh failed", error);
      setAccount((prev) => ({
        data: prev.data,
        loading: false,
        error: issueCodeOf(error),
      }));
    }
  }, []);

  const refreshKeys = useCallback(async () => {
    const current = tokenRef.current;
    if (!current) return;
    setKeys((prev) => ({ ...prev, loading: true }));
    try {
      const data = await fetchAccountKeys(current);
      setKeys({ data: data.keys, loading: false, error: null });
      setAccount((prev) =>
        prev.data
          ? { ...prev, data: { ...prev.data, preferences: data.preferences } }
          : prev,
      );
    } catch (error) {
      console.warn("[account] keys load failed", error);
      setKeys((prev) => ({ ...prev, loading: false, error: issueCodeOf(error) }));
    }
  }, []);

  const refreshImageModels = useCallback(async () => {
    const current = tokenRef.current;
    if (!current) return;
    imageModelsRequested.current = true;
    setImageModels((prev) => ({ ...prev, loading: true }));
    try {
      const data = await fetchImageModels(current);
      setImageModels({ data: data.models, loading: false, error: null });
    } catch (error) {
      // key_unavailable here means "no usable image key selected yet".
      setImageModels({ data: [], loading: false, error: issueCodeOf(error) });
    }
  }, []);

  const refreshChatModels = useCallback(async () => {
    const current = tokenRef.current;
    if (!current) return;
    chatModelsRequested.current = true;
    setChatModels((prev) => ({ ...prev, loading: true }));
    try {
      const data = await fetchModels(current);
      setChatModels({ data: data.models, loading: false, error: null });
    } catch (error) {
      setChatModels({ data: [], loading: false, error: issueCodeOf(error) });
    }
  }, []);

  const ensureImageModels = useCallback(() => {
    if (!imageModelsRequested.current) void refreshImageModels();
  }, [refreshImageModels]);

  const ensureChatModels = useCallback(() => {
    if (!chatModelsRequested.current) void refreshChatModels();
  }, [refreshChatModels]);

  const syncKeys = useCallback(async () => {
    const current = tokenRef.current;
    if (!current) return;
    await syncAccountKeys(current);
    await Promise.all([
      refreshKeys(),
      refreshAccount({ force: true }),
      imageModelsRequested.current ? refreshImageModels() : Promise.resolve(),
      chatModelsRequested.current ? refreshChatModels() : Promise.resolve(),
    ]);
  }, [refreshAccount, refreshChatModels, refreshImageModels, refreshKeys]);

  const updatePreferences = useCallback(
    async (patch: PreferencesPatch) => {
      const current = tokenRef.current;
      if (!current) throw new Error("not signed in");
      const { preferences } = await updateAccountPreferences(current, patch);
      setAccount((prev) =>
        prev.data ? { ...prev, data: { ...prev.data, preferences } } : prev,
      );
      const tasks: Promise<void>[] = [];
      if (patch.imageKeyId !== undefined) {
        tasks.push(refreshAccount({ force: true }));
        if (imageModelsRequested.current) tasks.push(refreshImageModels());
      }
      if (patch.chatKeyId !== undefined && chatModelsRequested.current)
        tasks.push(refreshChatModels());
      await Promise.all(tasks);
      return preferences;
    },
    [refreshAccount, refreshChatModels, refreshImageModels],
  );

  const notifyGenerationSettled = useCallback(() => {
    void refreshAccount({ force: true });
    if (followUpTimer.current) clearTimeout(followUpTimer.current);
    followUpTimer.current = setTimeout(() => {
      void refreshAccount({ force: true });
    }, BALANCE_CACHE_MS);
  }, [refreshAccount]);

  // Initial load once a session exists.
  useEffect(() => {
    if (!userId) return;
    void refreshAccount({ force: true });
  }, [userId, refreshAccount]);

  // Public config (egress IP, register links). Not user specific.
  useEffect(() => {
    let cancelled = false;
    fetchAuthConfig()
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch((error) => console.warn("[account] auth config unavailable", error));
    return () => {
      cancelled = true;
    };
  }, []);

  // Balance catches up when the user comes back from the main site tab.
  useEffect(() => {
    if (!userId) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshAccount();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId, refreshAccount]);

  useEffect(
    () => () => {
      if (followUpTimer.current) clearTimeout(followUpTimer.current);
    },
    [],
  );

  const value = useMemo<AccountContextValue>(
    () => ({
      account,
      keys,
      imageModels,
      chatModels,
      config,
      refreshAccount,
      refreshKeys,
      ensureImageModels,
      refreshImageModels,
      ensureChatModels,
      refreshChatModels,
      syncKeys,
      updatePreferences,
      notifyGenerationSettled,
    }),
    [
      account,
      keys,
      imageModels,
      chatModels,
      config,
      refreshAccount,
      refreshKeys,
      ensureImageModels,
      refreshImageModels,
      ensureChatModels,
      refreshChatModels,
      syncKeys,
      updatePreferences,
      notifyGenerationSettled,
    ],
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
}

/** Image models for the selected image key, loaded on first use. */
export function useImageModels() {
  const { imageModels, ensureImageModels, refreshImageModels } = useAccount();
  useEffect(() => {
    ensureImageModels();
  }, [ensureImageModels]);
  return { ...imageModels, refresh: refreshImageModels };
}

/** Chat models for the selected chat key, loaded on first use. */
export function useChatModels() {
  const { chatModels, ensureChatModels, refreshChatModels } = useAccount();
  useEffect(() => {
    ensureChatModels();
  }, [ensureChatModels]);
  return { ...chatModels, refresh: refreshChatModels };
}

/** Display name for the signed-in user: main-site username, else email. */
export function displayNameOf(account: AccountResponse | null): string {
  if (!account) return "";
  return account.user.username?.trim() || account.user.email;
}
