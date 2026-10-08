import type { ServerEnv } from "./env.js";
export function validateProductionEnv(
  env: ServerEnv,
  mode = process.env.NODE_ENV,
) {
  if (mode !== "production") return;
  for (const [name, value] of Object.entries({
    SUPABASE_URL: env.supabaseUrl,
    SUPABASE_ANON_KEY: env.supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: env.supabaseServiceRoleKey,
    SUPABASE_DB_URL: env.supabaseDbUrl,
  })) {
    if (!value) throw new Error(`Missing ${name} in production`);
  }
  for (const [name, value] of Object.entries({
    SUPABASE_URL: env.supabaseUrl,
    LOOMIC_WEB_ORIGIN: env.webOrigin,
    XY2API_BASE_URL: env.xy2apiBaseUrl,
    XY2API_WEB_URL: env.xy2apiWebUrl,
  })) {
    try {
      const u = new URL(value ?? "");
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.search ||
        u.hash
      )
        throw new Error();
    } catch {
      throw new Error(`Invalid ${name} in production`);
    }
  }
  if (env.supabaseInternalUrl) {
    try {
      const u = new URL(env.supabaseInternalUrl);
      if (
        !["http:", "https:"].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        u.pathname !== "/"
      )
        throw new Error();
    } catch {
      throw new Error("Invalid SUPABASE_INTERNAL_URL");
    }
  }
  try {
    if (
      !["postgres:", "postgresql:"].includes(
        new URL(env.supabaseDbUrl ?? "").protocol,
      )
    )
      throw new Error();
  } catch {
    throw new Error("Invalid SUPABASE_DB_URL");
  }
}
