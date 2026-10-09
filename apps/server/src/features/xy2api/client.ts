import { z } from "zod";
import { isMaskedKey, reportWireDrift } from "./compat.js";
import { Xy2apiError, extractXy2apiErrorId, record } from "./errors.js";

// Wire schemas are tolerant readers: unknown fields are ignored, optional or
// cosmetic fields fall back to safe defaults (reported via reportWireDrift),
// and only the fields we cannot work without are required. xy2api marks
// refresh_token / expires_in / user_email_masked as `omitempty`, so they may
// legitimately be absent. Recorded responses per xy2api version live in
// __fixtures__/<version> and are replayed by contract.replay.test.ts.

const wireId = z.union([
  z.number().int().positive(),
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number),
]);
const optionalNumber = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() !== "" ? Number(value) : value,
  z.number().finite().optional().catch(undefined),
);
const userSchema = z.object({
  id: wireId,
  email: z.string(),
  username: z.string().nullish(),
  role: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  status: z.string().optional(),
  balance: optionalNumber,
});
const tokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().nullish(),
  expires_in: optionalNumber,
});
export type Xy2apiUser = {
  id: number;
  email: string;
  username?: string | null | undefined;
  role?: string | undefined;
  status: string;
  balance?: number | undefined;
};
export type Xy2apiTokens = {
  access_token: string;
  /** null when xy2api did not issue/rotate a refresh token */
  refresh_token: string | null;
  expires_in: number;
};
export type LoginResult =
  | { kind: "ok"; tokens: Xy2apiTokens; user: Xy2apiUser }
  | { kind: "2fa"; tempToken: string; maskedEmail: string };
export type PublicSettings = {
  site_name?: string;
  version?: string;
  turnstile_enabled?: boolean;
  turnstile_site_key?: string;
  tencent_captcha_enabled?: boolean;
  aliyun_captcha_enabled?: boolean;
  /** any other `*captcha*_enabled` flag we do not know how to satisfy */
  unsupported_captcha_enabled?: boolean;
};
export type RemoteKey = {
  id: number;
  key: string;
  /** the list returned a masked key; it cannot be used against the gateway */
  masked?: boolean | undefined;
  name: string;
  status: string;
  quota: number;
  quota_used: number;
  expires_at?: string | null | undefined;
  ip_whitelist?: string[] | undefined;
  ip_blacklist?: string[] | undefined;
  group?:
    | {
        id: number;
        name: string;
        platform: string;
        status: string;
        subscription_type?: string | undefined;
        allow_image_generation?: boolean | undefined;
        rate_multiplier?: number | undefined;
        image_rate_independent?: boolean | undefined;
        image_rate_multiplier?: number | undefined;
        image_price_1k?: number | null | undefined;
        image_price_2k?: number | null | undefined;
        image_price_4k?: number | null | undefined;
      }
    | null
    | undefined;
};
/** Result of looking up one gateway request in the user's usage list. */
export type UsageLookup =
  | { kind: "found"; usageId: number | null; actualCost: number | null }
  /** every page of the range was read and no row carries the request id */
  | { kind: "absent" }
  /** page cap reached or rows without request_id: no conclusion */
  | { kind: "incomplete" };
export type Usage = {
  mode?: string;
  isValid?: boolean;
  planName?: string;
  remaining?: number;
  balance?: number;
  unit?: string;
};

const nullableNumber = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() !== "" ? Number(value) : value,
  z.number().finite().nullish().catch(null),
);
const stringList = z
  .array(z.string())
  .nullish()
  .catch(null)
  .transform((value) => value ?? undefined);
const remoteGroupSchema = z.object({
  id: wireId,
  name: z.string().catch(""),
  platform: z.string().catch(""),
  status: z.string().catch("unknown"),
  subscription_type: z.string().optional().catch(undefined),
  allow_image_generation: z.boolean().optional().catch(undefined),
  rate_multiplier: optionalNumber,
  image_rate_independent: z.boolean().optional().catch(undefined),
  image_rate_multiplier: optionalNumber,
  image_price_1k: nullableNumber,
  image_price_2k: nullableNumber,
  image_price_4k: nullableNumber,
});
const remoteKeySchema = z.object({
  id: wireId,
  key: z.string().min(1),
  name: z.string().catch(""),
  status: z.string().catch("unknown"),
  quota: optionalNumber,
  quota_used: optionalNumber,
  expires_at: z.string().nullish().catch(null),
  ip_whitelist: stringList,
  ip_blacklist: stringList,
  group: remoteGroupSchema.nullish().catch(null),
});
const usageSchema = z.object({
  mode: z.string().optional().catch(undefined),
  isValid: z.boolean().optional().catch(undefined),
  planName: z.string().optional().catch(undefined),
  remaining: optionalNumber,
  balance: optionalNumber,
  unit: z.string().optional().catch(undefined),
});

/** Seconds until the JWT `exp` claim, if the token is a readable JWT. */
function jwtTtlSeconds(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const exp = record(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    ).exp;
    if (typeof exp !== "number") return undefined;
    const ttl = Math.floor(exp - Date.now() / 1000);
    return ttl > 0 ? ttl : undefined;
  } catch {
    return undefined;
  }
}

function parseTokens(value: unknown, scope: string): Xy2apiTokens {
  const parsed = tokensSchema.safeParse(value);
  if (!parsed.success) throw new Xy2apiError(502, "INVALID_RESPONSE");
  const { access_token, refresh_token, expires_in } = parsed.data;
  let ttl = expires_in && expires_in > 0 ? expires_in : undefined;
  if (!ttl) {
    ttl = jwtTtlSeconds(access_token) ?? 900;
    reportWireDrift(scope, "expires_in_missing");
  }
  if (!refresh_token) reportWireDrift(scope, "refresh_token_missing");
  return {
    access_token,
    refresh_token: refresh_token || null,
    expires_in: ttl,
  };
}

function parseUser(value: unknown, scope: string): Xy2apiUser {
  const parsed = userSchema.safeParse(value);
  if (!parsed.success) throw new Xy2apiError(502, "INVALID_RESPONSE");
  const { status, ...user } = parsed.data;
  if (!status) reportWireDrift(scope, "user_status_missing");
  // xy2api's auth middleware rejects inactive users itself (401 USER_INACTIVE),
  // so a missing status on a successful response means "active".
  return { ...user, status: status ?? "active" };
}

function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 1)}***${name.length > 1 ? name.slice(-1) : ""}@${domain}`;
}

function parsePublicSettings(value: unknown): PublicSettings {
  const raw = record(value);
  const flag = (key: string) => raw[key] === true;
  const known = new Set([
    "turnstile_enabled",
    "tencent_captcha_enabled",
    "aliyun_captcha_enabled",
  ]);
  // New captcha providers show up as `<vendor>_captcha_enabled`; treat any we
  // cannot satisfy as blocking password login instead of failing obscurely.
  const unknownCaptcha = Object.keys(raw).some(
    (key) => /captcha.*_enabled$/.test(key) && !known.has(key) && flag(key),
  );
  return {
    ...(typeof raw.site_name === "string" ? { site_name: raw.site_name } : {}),
    ...(typeof raw.version === "string" ? { version: raw.version } : {}),
    turnstile_enabled: flag("turnstile_enabled"),
    ...(typeof raw.turnstile_site_key === "string"
      ? { turnstile_site_key: raw.turnstile_site_key }
      : {}),
    tencent_captcha_enabled: flag("tencent_captcha_enabled"),
    aliyun_captcha_enabled: flag("aliyun_captcha_enabled"),
    unsupported_captcha_enabled: unknownCaptcha,
  };
}

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
    if (!("code" in envelope)) {
      // A release that drops the {code,message,data} wrapper still carries the
      // payload; anything that is not a JSON object (HTML fallback) is invalid.
      if (body === null || typeof body !== "object" || Array.isArray(body))
        throw new Xy2apiError(502, "INVALID_RESPONSE");
      reportWireDrift(path.split("?")[0] ?? path, "envelope_missing");
      return body as T;
    }
    if (
      (envelope.code !== 0 && envelope.code !== "0") ||
      envelope.data === undefined
    )
      throw new Xy2apiError(502, "INVALID_RESPONSE");
    return envelope.data as T;
  }

  async getPublicSettings(): Promise<PublicSettings> {
    if (this.settingsCache && this.settingsCache.until > Date.now())
      return this.settingsCache.value;
    const value = await this.request<unknown>("/api/v1/settings/public")
      .then(parsePublicSettings)
      .catch(() => ({}));
    this.settingsCache = { value, until: Date.now() + 300000 };
    return value;
  }
  /** Running xy2api release (settings.version), bypassing the settings cache. */
  async getVersion(): Promise<string | null> {
    const settings = parsePublicSettings(
      await this.request<unknown>("/api/v1/settings/public", {
        timeout: 5000,
      }),
    );
    return settings.version ?? null;
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
          user_email_masked: z.string().optional().catch(undefined),
        })
        .safeParse(result);
      if (!parsed.success) throw new Xy2apiError(502, "INVALID_RESPONSE");
      return {
        kind: "2fa",
        tempToken: parsed.data.temp_token,
        maskedEmail: parsed.data.user_email_masked ?? maskEmail(input.email),
      };
    }
    return this.parseLogin(result, "auth.login");
  }
  async login2fa(tempToken: string, code: string) {
    return this.parseLogin(
      await this.request("/api/v1/auth/login/2fa", {
        method: "POST",
        body: { temp_token: tempToken, totp_code: code },
      }),
      "auth.login_2fa",
    );
  }
  private parseLogin(
    value: unknown,
    scope: string,
  ): Extract<LoginResult, { kind: "ok" }> {
    const tokens = parseTokens(value, scope);
    const user = parseUser(record(value).user, scope);
    return { kind: "ok", tokens, user };
  }
  async refresh(refreshToken: string): Promise<Xy2apiTokens> {
    return parseTokens(
      await this.request("/api/v1/auth/refresh", {
        method: "POST",
        body: { refresh_token: refreshToken },
      }),
      "auth.refresh",
    );
  }
  async me(token: string): Promise<Xy2apiUser> {
    return parseUser(
      await this.request("/api/v1/auth/me", { token }),
      "auth.me",
    );
  }
  async listKeys(token: string): Promise<RemoteKey[]> {
    const keys: RemoteKey[] = [];
    const pageSize = 100;
    for (let page = 1; page <= 1000; page++) {
      const result = record(
        await this.request<unknown>(
          `/api/v1/keys?page=${page}&page_size=${pageSize}`,
          { token },
        ),
      );
      const items = Array.isArray(result) ? result : result.items;
      if (!Array.isArray(items)) throw new Xy2apiError(502, "INVALID_RESPONSE");
      for (const item of items) {
        const parsed = remoteKeySchema.safeParse(item);
        if (!parsed.success) {
          // One malformed key must not hide the user's other keys.
          reportWireDrift("keys.list", "item_unparseable");
          continue;
        }
        const masked = isMaskedKey(parsed.data.key);
        if (masked) reportWireDrift("keys.list", "key_masked");
        keys.push({
          ...parsed.data,
          masked,
          quota: parsed.data.quota ?? 0,
          quota_used: parsed.data.quota_used ?? 0,
        });
      }
      // Stop on whichever pagination hint the release provides.
      const pages = Number(result.pages);
      const total = Number(result.total);
      if (Number.isInteger(pages) && pages > 0) {
        if (page >= pages) return keys;
      } else if (Number.isInteger(total) && total >= 0) {
        reportWireDrift("keys.list", "pages_missing");
        if (page * pageSize >= total) return keys;
      } else if (items.length < pageSize) {
        reportWireDrift("keys.list", "pagination_missing");
        return keys;
      }
      if (items.length === 0) return keys;
    }
    throw new Xy2apiError(502, "PAGINATION_LIMIT");
  }
  /** One key by id. Used when the list endpoint returns masked keys. */
  async getKey(token: string, id: number): Promise<RemoteKey> {
    const parsed = remoteKeySchema.safeParse(
      await this.request<unknown>(`/api/v1/keys/${id}`, { token }),
    );
    if (!parsed.success || parsed.data.id !== id)
      throw new Xy2apiError(502, "INVALID_RESPONSE");
    const masked = isMaskedKey(parsed.data.key);
    if (masked) reportWireDrift("keys.get", "key_masked");
    return {
      ...parsed.data,
      masked,
      quota: parsed.data.quota ?? 0,
      quota_used: parsed.data.quota_used ?? 0,
    };
  }
  /**
   * Finds the usage row xy2api wrote for one gateway request. Rows carry
   * request_id "client:<X-Client-Request-ID>" (0.2.2 and 0.2.5). `from`/`to`
   * are UTC days, both inclusive. At most `maxPages` pages are read: the
   * usage list counts against the user's heavy-query budget on the main site.
   */
  async findUsage(
    token: string,
    input: {
      requestId: string;
      from: Date;
      to: Date;
      apiKeyId?: number | undefined;
      maxPages?: number;
    },
  ): Promise<UsageLookup> {
    const day = (date: Date) => date.toISOString().slice(0, 10);
    const wanted = new Set([input.requestId, `client:${input.requestId}`]);
    const pageSize = 100;
    let unreadable = false;
    for (let page = 1; page <= (input.maxPages ?? 5); page++) {
      const query = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        start_date: day(input.from),
        end_date: day(input.to),
        timezone: "UTC",
        ...(input.apiKeyId ? { api_key_id: String(input.apiKeyId) } : {}),
      });
      const result = record(
        await this.request<unknown>(`/api/v1/usage?${query}`, { token }),
      );
      const items = Array.isArray(result) ? result : result.items;
      if (!Array.isArray(items)) throw new Xy2apiError(502, "INVALID_RESPONSE");
      for (const item of items) {
        const row = record(item);
        if (typeof row.request_id !== "string") {
          unreadable = true;
          continue;
        }
        if (!wanted.has(row.request_id)) continue;
        const usageId = Number(row.id);
        const cost = Number(row.actual_cost);
        return {
          kind: "found",
          usageId: Number.isSafeInteger(usageId) ? usageId : null,
          actualCost: Number.isFinite(cost) ? cost : null,
        };
      }
      if (unreadable) reportWireDrift("usage.list", "request_id_missing");
      const pages = Number(result.pages);
      const total = Number(result.total);
      const last =
        items.length === 0 ||
        (Number.isInteger(pages) && pages > 0
          ? page >= pages
          : Number.isInteger(total) && total >= 0
            ? page * pageSize >= total
            : items.length < pageSize);
      if (last) return unreadable ? { kind: "incomplete" } : { kind: "absent" };
    }
    return { kind: "incomplete" };
  }
  async logout(refreshToken: string): Promise<void> {
    await this.request("/api/v1/auth/logout", {
      method: "POST",
      body: { refresh_token: refreshToken },
    });
  }
  async listModels(apiKey: string): Promise<string[]> {
    const result = await this.request<unknown>("/v1/models", {
      token: apiKey,
      gateway: true,
      timeout: 10000,
    });
    // OpenAI shape {data:[{id}]}; tolerate Gemini-style {models:[{name}]}.
    const raw = record(result);
    const list = Array.isArray(raw.data)
      ? raw.data
      : Array.isArray(raw.models)
        ? raw.models
        : undefined;
    if (!list) throw new Xy2apiError(502, "INVALID_RESPONSE");
    return list
      .map((model) => {
        const m = record(model);
        if (typeof m.id === "string") return m.id;
        return typeof m.name === "string"
          ? m.name.replace(/^models\//, "")
          : undefined;
      })
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  /** Tier C: /v1/usage is xy2api-specific; every field is optional. */
  async getUsage(apiKey: string): Promise<Usage> {
    const parsed = usageSchema.safeParse(
      await this.request("/v1/usage", { token: apiKey, gateway: true }),
    );
    if (!parsed.success) throw new Xy2apiError(502, "INVALID_RESPONSE");
    if (
      parsed.data.balance === undefined &&
      parsed.data.remaining === undefined
    )
      reportWireDrift("gateway.usage", "balance_missing");
    return Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    ) as Usage;
  }
}
