/**
 * Browser client for the xy2api integration endpoints of the GGUU AI IMAGE API.
 *
 * The browser only ever talks to our API with its Supabase session.
 * Main-site JWTs and API keys never reach this code; the main site is only
 * opened in a new tab for register / recharge / key management / usage.
 *
 * Contract: docs/XY2API_FRONTEND_HANDOFF.md
 */
import { getServerBaseUrl } from "./env";
import { ApiApplicationError, toApiError } from "./server-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthConfig = {
  siteName: string;
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  /** Main site requires Tencent/Aliyun captcha: password login cannot work. */
  captchaUnsupported: boolean;
  registerUrl: string;
  forgotPasswordUrl: string;
  /** Egress IP to whitelist on keys with IP restrictions. Empty = ask admin. */
  egressIp: string;
};

export type LoginResult =
  | { status: "ok"; tokenHash: string }
  | { status: "2fa_required"; challenge: string; maskedEmail: string };

export type LoginErrorCode =
  | "invalid_credentials"
  | "account_disabled"
  | "captcha_failed"
  | "two_factor_invalid"
  | "rate_limited"
  | "xy2api_unavailable";

export type AccountBalance = {
  amount: number;
  unit: "USD";
  source: string;
  planName: string;
};

/** Response shape is snake_case; update requests are camelCase. */
export type AccountPreferences = {
  user_id: string;
  image_key_id: number | null;
  chat_key_id: number | null;
  default_image_model: string | null;
  default_chat_model: string | null;
};

export type AccountLinks = {
  recharge: string;
  keys: string;
  usage: string;
};

export type AccountResponse = {
  user: { xy2apiUserId: number; email: string; username: string | null };
  /** null = no usable image key or balance unavailable. Never show as $0. */
  balance: AccountBalance | null;
  preferences: AccountPreferences;
  links: AccountLinks;
};

export type KeyMetadata = {
  keyId: number;
  name: string;
  maskedKey: string;
  status: string;
  groupName: string | null;
  platform: string | null;
  imageCapable: boolean;
  imageModels: string[];
  chatModels: string[];
  /** Main-site metadata. P0 never uses it for estimates. */
  pricing: Record<string, unknown>;
  quota: number;
  quotaUsed: number;
  expiresAt: string | null;
  hasIpRestriction: boolean;
  invalidReason: string | null;
  syncedAt: string;
};

export type KeysResponse = {
  keys: KeyMetadata[];
  preferences: AccountPreferences;
};

export type PreferencesPatch = {
  imageKeyId?: number;
  chatKeyId?: number;
  defaultImageModel?: string;
  /** Bare id such as `gpt-5.4`, never `openai:gpt-5.4`. */
  defaultChatModel?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function readJson<T>(
  response: Response,
  options: { authExpiry: boolean; source: string },
): Promise<T> {
  if (!response.ok) throw await toApiError(response, options);
  return (await response.json()) as T;
}

function networkError(source: string, error: unknown): ApiApplicationError {
  console.error(`[xy2api] ${source} network failure`, error);
  return new ApiApplicationError(
    "xy2api_unavailable",
    "网络连接失败，请检查网络后再试",
  );
}

// ---------------------------------------------------------------------------
// Login (public; 401 here is a form error, not an expired session)
// ---------------------------------------------------------------------------

let configPromise: Promise<AuthConfig> | null = null;

/** Public login configuration. Cached per page load; failures are not cached. */
export function fetchAuthConfig(): Promise<AuthConfig> {
  configPromise ??= (async () => {
    try {
      const response = await fetch(
        `${getServerBaseUrl()}/api/auth/xy2api/config`,
      );
      return await readJson<AuthConfig>(response, {
        authExpiry: false,
        source: "auth-config",
      });
    } catch (error) {
      configPromise = null;
      if (error instanceof ApiApplicationError) throw error;
      throw networkError("auth-config", error);
    }
  })();
  return configPromise;
}

/** Test hook: forget the cached config. */
export function resetAuthConfigCache() {
  configPromise = null;
}

export async function loginWithPassword(input: {
  email: string;
  password: string;
  turnstileToken?: string;
}): Promise<LoginResult> {
  let response: Response;
  try {
    response = await fetch(`${getServerBaseUrl()}/api/auth/xy2api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        ...(input.turnstileToken
          ? { turnstileToken: input.turnstileToken }
          : {}),
      }),
    });
  } catch (error) {
    throw networkError("login", error);
  }
  return readJson<LoginResult>(response, {
    authExpiry: false,
    source: "login",
  });
}

export async function loginWithTotp(input: {
  challenge: string;
  code: string;
}): Promise<Extract<LoginResult, { status: "ok" }>> {
  let response: Response;
  try {
    response = await fetch(`${getServerBaseUrl()}/api/auth/xy2api/login/2fa`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (error) {
    throw networkError("login-2fa", error);
  }
  return readJson(response, { authExpiry: false, source: "login-2fa" });
}

/**
 * Best-effort server logout (revokes the main-site integration session).
 * Never throws: a backend hiccup must not block local sign-out.
 */
export async function logoutXy2api(accessToken: string, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${getServerBaseUrl()}/api/auth/xy2api/logout`, {
      method: "POST",
      headers: authHeaders(accessToken),
      signal: controller.signal,
    });
  } catch (error) {
    console.warn("[xy2api] logout request failed; continuing locally", error);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Account, balance, keys
// ---------------------------------------------------------------------------

export async function fetchAccount(
  accessToken: string,
): Promise<AccountResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/account`, {
    headers: authHeaders(accessToken),
  });
  return readJson(response, { authExpiry: true, source: "account" });
}

export async function fetchAccountKeys(
  accessToken: string,
): Promise<KeysResponse> {
  const response = await fetch(`${getServerBaseUrl()}/api/account/keys`, {
    headers: authHeaders(accessToken),
  });
  return readJson(response, { authExpiry: true, source: "account-keys" });
}

export async function syncAccountKeys(accessToken: string): Promise<void> {
  const response = await fetch(`${getServerBaseUrl()}/api/account/keys/sync`, {
    method: "POST",
    headers: authHeaders(accessToken),
  });
  await readJson<{ ok: true }>(response, {
    authExpiry: true,
    source: "account-keys-sync",
  });
}

export async function updateAccountPreferences(
  accessToken: string,
  patch: PreferencesPatch,
): Promise<{ preferences: AccountPreferences }> {
  const response = await fetch(`${getServerBaseUrl()}/api/account/preferences`, {
    method: "PUT",
    headers: { ...authHeaders(accessToken), "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  return readJson(response, { authExpiry: true, source: "preferences" });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * USD with the precision the handoff asks for: three decimals below $1,
 * two decimals otherwise. Never call with a null balance.
 */
export function formatUsd(amount: number): string {
  const digits = Math.abs(amount) < 1 ? 3 : 2;
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
