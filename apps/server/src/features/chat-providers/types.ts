export type ChatProviderRow = {
  id: string;
  user_id: string;
  name: string;
  protocol: "openai_compatible";
  base_url: string;
  secret_enc: string;
  key_hint: string;
  models: string[];
  models_source: "fetched" | "manual";
  enabled: boolean;
  last_checked_at: string | null;
  last_error: string | null;
  created_at?: string;
  updated_at?: string;
};
export function publicProvider(row: ChatProviderRow) {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.base_url,
    keyHint: row.key_hint,
    models: row.models,
    modelsSource: row.models_source,
    enabled: row.enabled,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
  };
}
export type PublicChatProvider = ReturnType<typeof publicProvider>;
