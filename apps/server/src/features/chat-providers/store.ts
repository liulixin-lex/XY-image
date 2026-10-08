import type { AdminSupabaseClient } from "../../supabase/admin.js";
import { integrationClient } from "../xy2api/store.js";
import { ChatProviderError } from "./errors.js";
import type { ChatProviderRow } from "./types.js";

export interface ChatProviderStore {
  list(userId: string): Promise<ChatProviderRow[]>;
  get(userId: string, id: string): Promise<ChatProviderRow | null>;
  insert(row: ChatProviderRow): Promise<ChatProviderRow>;
  update(
    userId: string,
    id: string,
    patch: Partial<ChatProviderRow>,
  ): Promise<ChatProviderRow>;
  delete(userId: string, id: string): Promise<void>;
}
function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "23505")
    throw new ChatProviderError("provider_name_taken", 409);
  if (error.code === "P0001" && error.message === "provider_limit_reached")
    throw new ChatProviderError("provider_limit_reached", 409);
  throw new ChatProviderError("provider_unavailable", 503);
}
export function createChatProviderStore(
  getAdmin: () => AdminSupabaseClient,
): ChatProviderStore {
  const db = () => integrationClient(getAdmin());
  return {
    async list(userId) {
      const { data, error } = await db()
        .from("user_chat_providers")
        .select("*")
        .eq("user_id", userId)
        .order("created_at")
        .order("id");
      check(error);
      return data ?? [];
    },
    async get(userId, id) {
      const { data, error } = await db()
        .from("user_chat_providers")
        .select("*")
        .eq("user_id", userId)
        .eq("id", id)
        .maybeSingle();
      check(error);
      return data;
    },
    async insert(row) {
      const { data, error } = await db()
        .from("user_chat_providers")
        .insert(row)
        .select("*")
        .single();
      check(error);
      if (!data) throw new ChatProviderError("provider_unavailable", 503);
      return data;
    },
    async update(userId, id, patch) {
      const { data, error } = await db()
        .from("user_chat_providers")
        .update(patch)
        .eq("user_id", userId)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      check(error);
      if (!data) throw new ChatProviderError("provider_not_found", 404);
      return data;
    },
    async delete(userId, id) {
      // Migration trigger clears the two preference columns in this same transaction.
      const { error } = await db()
        .from("user_chat_providers")
        .delete()
        .eq("user_id", userId)
        .eq("id", id);
      check(error);
    },
  };
}
