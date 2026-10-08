const defaultServerBaseUrl = "http://localhost:3001";

export function getServerBaseUrl() {
  // Must access process.env.NEXT_PUBLIC_* directly — webpack DefinePlugin
  // only replaces direct references, not indirect access via a variable.
  const configuredUrl = process.env.NEXT_PUBLIC_SERVER_BASE_URL?.trim();
  return configuredUrl || defaultServerBaseUrl;
}

/**
 * Public URL of the xy2api main site (register, recharge, key management).
 *
 * The API also returns these links from `/api/auth/xy2api/config` and
 * `/api/account`; prefer those at runtime. This value is only the build-time
 * fallback for pages rendered before any API call (landing page, footer).
 */
export function getXy2apiWebUrl(): string | null {
  const configuredUrl = process.env.NEXT_PUBLIC_XY2API_WEB_URL?.trim();
  return configuredUrl ? configuredUrl.replace(/\/+$/, "") : null;
}

export type WebEnv = {
  serverBaseUrl: string;
  supabaseAnonKey: string;
  supabaseUrl: string;
};

/**
 * Resolve the browser env. `source` exists for tests; at runtime the values
 * must come from direct `process.env.NEXT_PUBLIC_*` references so Next.js can
 * inline them into the static export.
 */
export function loadWebEnv(
  overrides: Partial<WebEnv> = {},
  source?: NodeJS.ProcessEnv,
): WebEnv {
  const serverBaseUrl = source
    ? source.NEXT_PUBLIC_SERVER_BASE_URL?.trim() || defaultServerBaseUrl
    : getServerBaseUrl();
  return {
    serverBaseUrl: overrides.serverBaseUrl ?? serverBaseUrl,
    supabaseUrl:
      overrides.supabaseUrl ??
      requireEnv(
        "NEXT_PUBLIC_SUPABASE_URL",
        source
          ? source.NEXT_PUBLIC_SUPABASE_URL
          : process.env.NEXT_PUBLIC_SUPABASE_URL,
      ),
    supabaseAnonKey:
      overrides.supabaseAnonKey ??
      requireEnv(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        source
          ? source.NEXT_PUBLIC_SUPABASE_ANON_KEY
          : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
  };
}

function requireEnv(name: string, value: string | undefined) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(`Missing required browser env: ${name}`);
  }

  return normalizedValue;
}
