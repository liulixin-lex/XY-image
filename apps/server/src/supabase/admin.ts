import { type SupabaseClient, createClient } from "@supabase/supabase-js";

import { createSupabaseFetch } from "./transport.js";

import type { Database } from "@loomic/shared";

import type { ServerEnv } from "../config/env.js";

export type AdminSupabaseClient = SupabaseClient<Database>;

export function createAdminSupabaseClient(
  env: Pick<
    ServerEnv,
    "supabaseServiceRoleKey" | "supabaseUrl" | "supabaseInternalUrl"
  >,
): AdminSupabaseClient {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase admin access.",
    );
  }

  return createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    global: { fetch: createSupabaseFetch(env) },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
