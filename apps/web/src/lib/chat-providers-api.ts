/**
 * Browser client for the user's own chat model providers (plan §6.4,
 * `/api/chat-providers`). Requests and responses are camelCase.
 *
 * The API key is write-only: it leaves the browser once, in a create or
 * update body, and never comes back. Responses carry only `keyHint` (the
 * last 4 characters). Nothing here stores, caches or logs the key.
 */
import { getServerBaseUrl } from "./env";
import { ApiApplicationError, toApiError } from "./server-api";

export type ChatProvider = {
  id: string;
  name: string;
  protocol: "openai_compatible";
  /** Normalised by the server: https, no trailing slash, up to `/v1`. */
  baseUrl: string;
  /** Last 4 characters of the saved key, for recognising it. */
  keyHint: string;
  models: string[];
  /** fetched = read from `GET {baseUrl}/models`; manual = typed by the user. */
  modelsSource: "fetched" | "manual";
  enabled: boolean;
  lastCheckedAt: string | null;
  /** Error code of the last check (`provider_auth_failed`, ...); never upstream text. */
  lastError: string | null;
};

export type ChatProviderCreate = {
  name: string;
  protocol: "openai_compatible";
  baseUrl: string;
  apiKey: string;
  /** Present = manual list (also saved when the provider has no list endpoint). */
  models?: string[];
};

export type ChatProviderPatch = {
  name?: string;
  /** Changing it requires `apiKey` in the same request (server returns 400 otherwise). */
  baseUrl?: string;
  apiKey?: string;
  /** Present = switch to / replace the manual list. */
  models?: string[];
  enabled?: boolean;
};

/** Server-side limits (plan §6.2); the form checks them first for faster feedback. */
export const CHAT_PROVIDER_LIMITS = {
  providers: 10,
  models: 200,
  nameLength: 40,
  baseUrlLength: 300,
  /** Same bound as `defaultChatModel` in the preferences API. */
  modelNameLength: 200,
} as const;

const SOURCE = "chat-providers";

function headers(accessToken: string, json = false): Record<string, string> {
  return json
    ? { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" }
    : { Authorization: `Bearer ${accessToken}` };
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getServerBaseUrl()}${path}`, init);
  } catch (error) {
    // Only the path and method are logged: bodies may hold the key.
    console.error(`[chat-provider] ${init.method ?? "GET"} ${path} network failure`, error);
    throw new ApiApplicationError("network_error", "网络连接失败，请检查网络后再试");
  }
  if (!response.ok) {
    const error = await toApiError(response, { authExpiry: true, source: SOURCE });
    console.warn(
      `[chat-provider] ${init.method ?? "GET"} ${path} → ${response.status}`,
      error instanceof ApiApplicationError ? error.code : "auth",
    );
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * True when the API has no provider endpoints yet (an older server): Fastify
 * answers unknown routes with a bare 404 and no `error.code`.
 */
export function isEndpointMissing(error: unknown): boolean {
  return (
    error instanceof ApiApplicationError &&
    error.status === 404 &&
    error.code === "application_error"
  );
}

export async function fetchChatProviders(accessToken: string): Promise<ChatProvider[]> {
  const body = await send<{ providers: ChatProvider[] }>("/api/chat-providers", {
    headers: headers(accessToken),
  });
  return body.providers ?? [];
}

export async function createChatProvider(
  accessToken: string,
  input: ChatProviderCreate,
): Promise<ChatProvider> {
  const body = await send<{ provider: ChatProvider }>("/api/chat-providers", {
    method: "POST",
    headers: headers(accessToken, true),
    body: JSON.stringify(input),
  });
  return body.provider;
}

export async function updateChatProvider(
  accessToken: string,
  id: string,
  patch: ChatProviderPatch,
): Promise<ChatProvider> {
  const body = await send<{ provider: ChatProvider }>(
    `/api/chat-providers/${encodeURIComponent(id)}`,
    { method: "PATCH", headers: headers(accessToken, true), body: JSON.stringify(patch) },
  );
  return body.provider;
}

export async function deleteChatProvider(accessToken: string, id: string): Promise<void> {
  await send<unknown>(`/api/chat-providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(accessToken),
  });
}

/** Re-reads the model list. Sends no chat request: only the provider's list endpoint. */
export async function refreshChatProviderModels(
  accessToken: string,
  id: string,
): Promise<ChatProvider> {
  const body = await send<{ provider: ChatProvider }>(
    `/api/chat-providers/${encodeURIComponent(id)}/refresh-models`,
    { method: "POST", headers: headers(accessToken) },
  );
  return body.provider;
}
