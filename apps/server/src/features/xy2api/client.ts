import { z } from "zod";
import { Xy2apiError, extractXy2apiErrorId, record } from "./errors.js";

const userSchema = z.object({
  id: z.number().int().positive(),
  email: z.string(),
  username: z.string().nullish(),
  role: z.string().optional(),
  status: z.string(),
  balance: z.number().optional(),
});
const tokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
});
export type Xy2apiUser = z.infer<typeof userSchema>;
export type Xy2apiTokens = z.infer<typeof tokensSchema>;
export type LoginResult =
  | { kind: "ok"; tokens: Xy2apiTokens; user: Xy2apiUser }
  | { kind: "2fa"; tempToken: string; maskedEmail: string };
export type PublicSettings = {
  site_name?: string;
  turnstile_enabled?: boolean;
  turnstile_site_key?: string;
  tencent_captcha_enabled?: boolean;
  aliyun_captcha_enabled?: boolean;
};
export type RemoteKey = {
  id: number;
  key: string;
  name: string;
  status: string;
  quota: number;
  quota_used: number;
  expires_at?: string | null;
  ip_whitelist?: string[];
  ip_blacklist?: string[];
  group?: {
    id: number;
    name: string;
    platform: string;
    status: string;
    subscription_type?: string;
    allow_image_generation?: boolean;
    rate_multiplier?: number;
    image_rate_independent?: boolean;
    image_rate_multiplier?: number;
    image_price_1k?: number | null;
    image_price_2k?: number | null;
    image_price_4k?: number | null;
  } | null;
};
export type Usage = {
  mode?: string;
  isValid?: boolean;
  planName?: string;
  remaining?: number;
  balance?: number;
  unit?: string;
};

export class Xy2apiClient {
  private settingsCache: { value: PublicSettings; until: number } | undefined;
  constructor(
    readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request<T>(
    path: string,
    options: {
      token?: string;
      method?: string;
      body?: unknown;
      gateway?: boolean;
      timeout?: number;
    } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: {
          "User-Agent": "LoomicServer/1.0",
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.token
            ? { Authorization: `Bearer ${options.token}` }
            : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(options.timeout ?? 15000),
        redirect: "error",
      });
    } catch {
      throw new Xy2apiError(503, "NETWORK_ERROR");
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok)
      throw new Xy2apiError(
        response.status,
        extractXy2apiErrorId(response.status, body),
        Math.min(
          300,
          Math.max(1, Number(response.headers.get("retry-after")) || 60),
        ),
      );
    if (options.gateway) return body as T;
    const envelope = record(body);
    if (envelope.code !== 0 || envelope.data === undefined)
      throw new Xy2apiError(502, "INVALID_RESPONSE");
    return envelope.data as T;
  }

  async getPublicSettings(): Promise<PublicSettings> {
    if (this.settingsCache && this.settingsCache.until > Date.now())
      return this.settingsCache.value;
    const value = await this.request<PublicSettings>(
      "/api/v1/settings/public",
    ).catch(() => ({}));
    this.settingsCache = { value, until: Date.now() + 300000 };
    return value;
  }
  async login(input: {
    email: string;
    password: string;
    turnstile_token?: string;
  }): Promise<LoginResult> {
    const result = await this.request<Record<string, unknown>>(
      "/api/v1/auth/login",
      { method: "POST", body: input },
    );
    if (result.requires_2fa === true) {
      const parsed = z
        .object({
          temp_token: z.string().min(1),
          user_email_masked: z.string(),
        })
        .safeParse(result);
      if (!parsed.success) throw new Xy2apiError(502, "INVALID_RESPONSE");
      return {
        kind: "2fa",
        tempToken: parsed.data.temp_token,
        maskedEmail: parsed.data.user_email_masked,
      };
    }
    return this.parseLogin(result);
  }
  async login2fa(tempToken: string, code: string) {
    return this.parseLogin(
      await this.request("/api/v1/auth/login/2fa", {
        method: "POST",
        body: { temp_token: tempToken, totp_code: code },
      }),
    );
  }
  private parseLogin(value: unknown): Extract<LoginResult, { kind: "ok" }> {
    const parsed = tokensSchema.extend({ user: userSchema }).safeParse(value);
    if (!parsed.success) throw new Xy2apiError(502, "INVALID_RESPONSE");
    const { user, ...tokens } = parsed.data;
    return { kind: "ok", tokens, user };
  }
  async refresh(refreshToken: string): Promise<Xy2apiTokens> {
    const parsed = tokensSchema.safeParse(
      await this.request("/api/v1/auth/refresh", {
        method: "POST",
        body: { refresh_token: refreshToken },
      }),
    );
    if (!parsed.success) throw new Xy2apiError(502, "INVALID_RESPONSE");
    return parsed.data;
  }
  async me(token: string): Promise<Xy2apiUser> {
    const parsed = userSchema.safeParse(
      await this.request("/api/v1/auth/me", { token }),
    );
    if (!parsed.success) throw new Xy2apiError(502, "INVALID_RESPONSE");
    return parsed.data;
  }
  async listKeys(token: string): Promise<RemoteKey[]> {
    const keys: RemoteKey[] = [];
    for (let page = 1; page <= 1000; page++) {
      const result = await this.request<{ items: RemoteKey[]; pages: number }>(
        `/api/v1/keys?page=${page}&page_size=100`,
        { token },
      );
      if (!Array.isArray(result.items) || !Number.isInteger(result.pages))
        throw new Xy2apiError(502, "INVALID_RESPONSE");
      keys.push(...result.items);
      if (page >= result.pages) return keys;
    }
    throw new Xy2apiError(502, "PAGINATION_LIMIT");
  }
  async logout(refreshToken: string): Promise<void> {
    await this.request("/api/v1/auth/logout", {
      method: "POST",
      body: { refresh_token: refreshToken },
    });
  }
  async listModels(apiKey: string): Promise<string[]> {
    const result = await this.request<{ data: { id: string }[] }>(
      "/v1/models",
      { token: apiKey, gateway: true, timeout: 10000 },
    );
    if (!Array.isArray(result?.data))
      throw new Xy2apiError(502, "INVALID_RESPONSE");
    return result.data
      .map((model) => model.id)
      .filter((id) => typeof id === "string");
  }
  getUsage(apiKey: string): Promise<Usage> {
    return this.request("/v1/usage", { token: apiKey, gateway: true });
  }
}
