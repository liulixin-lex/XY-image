import type { Database, Json } from "@loomic/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import type { ChatProviderRow } from "../chat-providers/types.js";

export type AccountRow = {
  user_id: string;
  xy2api_user_id: number;
  email: string;
  username: string | null;
  role: string | null;
  status: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  access_token_expires_at: string | null;
  session_state: "active" | "reauth_required";
  last_validated_at: string | null;
  last_login_at: string;
};
export type KeyRow = {
  user_id: string;
  key_id: number;
  name: string;
  masked_key: string;
  secret_enc: string;
  status: string;
  group_id: number | null;
  group_name: string | null;
  platform: string | null;
  subscription_type: string | null;
  allow_image_generation: boolean;
  image_capable: boolean;
  pricing: Json;
  image_models: string[];
  chat_models: string[];
  quota: number;
  quota_used: number;
  expires_at: string | null;
  has_ip_restriction: boolean;
  invalid_reason: string | null;
  synced_at: string;
};
export type PreferencesRow = {
  user_id: string;
  image_key_id: number | null;
  chat_key_id: number | null;
  default_image_model: string | null;
  default_chat_model: string | null;
  default_chat_provider_id: string | null;
};
type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};
type IntegrationDatabase = {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      increment_job_attempt: {
        Args: { p_job_id: string };
        Returns: { attempt_count: number; max_attempts: number }[];
      };
    };
    Tables: Omit<Database["public"]["Tables"], "background_jobs"> & {
      background_jobs: Table<
        Database["public"]["Tables"]["background_jobs"]["Row"] & {
          xy2api_key_id: number | null;
          xy2api_request_id: string | null;
          estimated_cost_usd: number | null;
          billing_status: string;
        }
      >;
      user_chat_providers: Table<ChatProviderRow>;
      xy2api_accounts: Table<AccountRow>;
      xy2api_api_keys: Table<KeyRow>;
      xy2api_preferences: Table<PreferencesRow>;
    };
  };
};
export function integrationClient(
  admin: AdminSupabaseClient,
): SupabaseClient<IntegrationDatabase> {
  return admin as unknown as SupabaseClient<IntegrationDatabase>;
}
export function checkStoreError(error: unknown): void {
  if (error) throw new Error("Account storage unavailable");
}

export interface AccountStore {
  get(userId: string): Promise<AccountRow | null>;
  find(xy2apiUserId: number): Promise<AccountRow | null>;
  save(row: Partial<AccountRow> & { user_id: string }): Promise<void>;
  createShadow(
    email: string,
    xy2apiUserId: number,
    displayName: string,
  ): Promise<string>;
  loginLink(email: string): Promise<{ userId: string; tokenHash: string }>;
}
export function createAccountStore(
  getAdmin: () => AdminSupabaseClient,
): AccountStore {
  const client = () => integrationClient(getAdmin());
  return {
    async get(userId) {
      const { data, error } = await client()
        .from("xy2api_accounts")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      checkStoreError(error);
      return data;
    },
    async find(id) {
      const { data, error } = await client()
        .from("xy2api_accounts")
        .select("*")
        .eq("xy2api_user_id", id)
        .maybeSingle();
      checkStoreError(error);
      return data;
    },
    async save(row) {
      const query = client().from("xy2api_accounts");
      const { error } = await (row.xy2api_user_id === undefined
        ? query.update(row).eq("user_id", row.user_id)
        : query.upsert(row));
      checkStoreError(error);
    },
    async createShadow(email, id, displayName) {
      const { data, error } = await getAdmin().auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { provider: "xy2api", xy2api_user_id: id },
        user_metadata: { display_name: displayName },
      });
      if (data.user && !error) return data.user.id;
      if (
        error?.code === "email_exists" ||
        error?.code === "email_conflict" ||
        error?.status === 422
      ) {
        const link = await this.loginLink(email);
        return link.userId;
      }
      throw new Error("Unable to create shadow account");
    },
    async loginLink(email) {
      const { data, error } = await getAdmin().auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      if (
        error ||
        !data.user ||
        !data.properties?.hashed_token ||
        data.user.app_metadata?.provider !== "xy2api"
      )
        throw new Error("Unable to create shadow session");
      return { userId: data.user.id, tokenHash: data.properties.hashed_token };
    },
  };
}
