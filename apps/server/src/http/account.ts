import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { ServerEnv } from "../config/env.js";
import { ChatProviderError } from "../features/chat-providers/errors.js";
import type { AccountService } from "../features/xy2api/account-service.js";
import type { Usage, Xy2apiClient } from "../features/xy2api/client.js";
import { BillingGuardError, Xy2apiError } from "../features/xy2api/errors.js";
import type { KeyService } from "../features/xy2api/key-service.js";
import type { RequestAuthenticator } from "../supabase/user.js";

export function sendAccountError(reply: FastifyReply, error: unknown) {
  if (error instanceof BillingGuardError || error instanceof ChatProviderError)
    return reply
      .code(error.statusCode)
      .send({ error: { code: error.code, message: error.message } });
  if (error instanceof z.ZodError)
    return reply
      .code(400)
      .send({ error: { code: "invalid_input", message: "请求参数无效" } });
  if (error instanceof Xy2apiError && error.status === 429)
    return reply
      .code(429)
      .header("Retry-After", String(error.retryAfter))
      .send({
        error: { code: "rate_limited", message: "请求过于频繁，请稍后再试" },
      });
  return reply.code(503).send({
    error: {
      code: "xy2api_unavailable",
      message: "主站暂时不可用，请稍后再试",
    },
  });
}
export function registerAccountRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    accounts: AccountService;
    keys: KeyService;
    client: Xy2apiClient;
    env: ServerEnv;
  },
) {
  const balances = new Map<
    string,
    { usage: Usage; until: number; keyId: number }
  >();
  const prefsSchema = z
    .object({
      imageKeyId: z.number().int().positive().optional(),
      chatKeyId: z.number().int().positive().optional(),
      defaultImageModel: z.string().max(200).optional(),
      defaultChatModel: z.string().max(200).optional(),
      defaultChatProviderId: z.uuid().nullable().optional(),
    })
    .strict();
  const links = {
    recharge: `${options.env.xy2apiWebUrl}/purchase`,
    keys: `${options.env.xy2apiWebUrl}/keys`,
    usage: `${options.env.xy2apiWebUrl}/usage`,
  };
  app.get("/api/account", async (request, reply) => {
    try {
      reply.header("Cache-Control", "no-store");
      const user = await options.auth.authenticate(request);
      if (!user) throw new BillingGuardError("xy2api_reauth_required", 401);
      const account = await options.accounts.requireAccount(user.id);
      let balance: {
        amount: number;
        unit: "USD";
        source: string;
        planName: string;
      } | null = null;
      try {
        const credential = await options.keys.resolveImageCredential(user.id);
        const cached = balances.get(user.id);
        const usage =
          cached &&
          cached.until > Date.now() &&
          cached.keyId === credential.keyId
            ? cached.usage
            : await options.client.getUsage(credential.apiKey);
        if (
          !cached ||
          cached.until <= Date.now() ||
          cached.keyId !== credential.keyId
        )
          balances.set(user.id, {
            usage,
            until: Date.now() + 15000,
            keyId: credential.keyId,
          });
        const amount = usage.balance ?? usage.remaining;
        if (typeof amount === "number" && Number.isFinite(amount))
          balance = {
            amount,
            unit: "USD",
            source: usage.mode ?? "wallet",
            planName: usage.planName ?? "",
          };
      } catch {
        /* The account page remains available without a usable key. */
      }
      return {
        user: {
          xy2apiUserId: account.xy2api_user_id,
          email: account.email,
          username: account.username,
        },
        balance,
        preferences: await options.keys.preferences(user.id),
        links,
      };
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });
  app.get("/api/account/keys", async (request, reply) => {
    try {
      reply.header("Cache-Control", "no-store");
      const user = await options.auth.authenticate(request);
      if (!user) throw new BillingGuardError("xy2api_reauth_required", 401);
      const rows = await options.keys.rows(user.id);
      return {
        keys: rows.map((row) => ({
          keyId: row.key_id,
          name: row.name,
          maskedKey: row.masked_key,
          status: row.status,
          groupName: row.group_name,
          platform: row.platform,
          imageCapable: row.image_capable,
          imageModels: row.image_models,
          chatModels: row.chat_models,
          pricing: row.pricing,
          quota: row.quota,
          quotaUsed: row.quota_used,
          expiresAt: row.expires_at,
          hasIpRestriction: row.has_ip_restriction,
          invalidReason: row.invalid_reason,
          syncedAt: row.synced_at,
        })),
        preferences: await options.keys.preferences(user.id),
      };
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });
  app.post("/api/account/keys/sync", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) throw new BillingGuardError("xy2api_reauth_required", 401);
      await options.keys.syncKeys(user.id);
      balances.delete(user.id);
      return { ok: true };
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });
  app.get("/api/account/preferences", async (request, reply) => {
    try {
      reply.header("Cache-Control", "no-store");
      const user = await options.auth.authenticate(request);
      if (!user) throw new BillingGuardError("xy2api_reauth_required", 401);
      return { preferences: await options.keys.preferences(user.id) };
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });
  app.put("/api/account/preferences", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) throw new BillingGuardError("xy2api_reauth_required", 401);
      const preferences = await options.keys.updatePreferences(
        user.id,
        prefsSchema.parse(request.body),
      );
      balances.delete(user.id);
      return { preferences };
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });
}
