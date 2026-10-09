import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { ServerEnv } from "../config/env.js";
import type { AccountService } from "../features/xy2api/account-service.js";
import type { Xy2apiClient } from "../features/xy2api/client.js";
import { BillingGuardError, Xy2apiError } from "../features/xy2api/errors.js";
import type { SecretBox } from "../features/xy2api/secret-box.js";
import type { RequestAuthenticator } from "../supabase/user.js";

const loginSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(1024),
  turnstileToken: z.string().max(4096).optional(),
});
const twoFactorSchema = z.object({
  challenge: z.string().max(16384),
  code: z.string().regex(/^\d{6}$/),
});
const challengeSchema = z.object({
  tempToken: z.string(),
  email: z.string(),
  exp: z.number(),
});
const messages = {
  invalid_credentials: "邮箱或密码错误",
  account_disabled: "账号不可用，请联系主站客服",
  captcha_failed: "人机验证失败，请重试",
  two_factor_invalid: "验证码错误或已过期",
  rate_limited: "尝试太频繁，请稍后再试",
  xy2api_unavailable: "主站暂时不可用，请稍后再试",
};

export function registerXy2apiAuthRoutes(
  app: FastifyInstance,
  options: {
    client: Xy2apiClient;
    accounts: AccountService;
    box: SecretBox;
    env: ServerEnv;
    auth: RequestAuthenticator;
  },
) {
  const counts = new Map<string, { count: number; until: number }>();
  const consumed = new Map<string, number>();
  const inFlight = new Set<string>();
  function limit(ip: string, email?: string) {
    const now = Date.now();
    for (const [key, value] of counts)
      if (value.until <= now) counts.delete(key);
    for (const [key, expiry] of consumed)
      if (expiry <= now) consumed.delete(key);
    for (const key of [`ip:${ip}`, ...(email ? [`email:${email}`] : [])]) {
      const value = counts.get(key) ?? { count: 0, until: now + 300000 };
      value.count++;
      counts.set(key, value);
      if (value.count > 10 || counts.size > 20000)
        throw new Xy2apiError(
          429,
          "LOCAL_RATE_LIMIT",
          Math.ceil((value.until - now) / 1000),
        );
    }
  }
  app.get("/api/auth/xy2api/config", async () => {
    const settings = await options.client.getPublicSettings();
    return {
      siteName: settings.site_name || "主站",
      turnstileEnabled: Boolean(settings.turnstile_enabled),
      turnstileSiteKey: settings.turnstile_site_key || "",
      captchaUnsupported: Boolean(
        settings.tencent_captcha_enabled ||
          settings.aliyun_captcha_enabled ||
          settings.unsupported_captcha_enabled,
      ),
      registerUrl: `${options.env.xy2apiWebUrl}/register`,
      forgotPasswordUrl: `${options.env.xy2apiWebUrl}/forgot-password`,
      egressIp: options.env.egressIp || "",
    };
  });
  app.post("/api/auth/xy2api/login", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const parsed = loginSchema.safeParse(request.body);
      limit(request.ip, parsed.success ? parsed.data.email : undefined);
      if (!parsed.success)
        return reply.code(400).send({
          error: {
            code: "invalid_credentials",
            message: messages.invalid_credentials,
          },
        });
      const input = parsed.data;
      const settings = await options.client.getPublicSettings();
      if (
        settings.tencent_captcha_enabled ||
        settings.aliyun_captcha_enabled ||
        settings.unsupported_captcha_enabled
      )
        return reply.code(400).send({
          error: {
            code: "captcha_failed",
            message:
              "主站启用了生图站暂不支持的验证码，暂时无法账密登录，请联系管理员",
          },
        });
      const result = await options.client.login({
        email: input.email,
        password: input.password,
        ...(input.turnstileToken
          ? { turnstile_token: input.turnstileToken }
          : {}),
      });
      if (result.kind === "2fa")
        return {
          status: "2fa_required",
          challenge: options.box.sealSecret(
            JSON.stringify({
              tempToken: result.tempToken,
              email: input.email,
              exp: Date.now() + 300000,
            }),
          ),
          maskedEmail: result.maskedEmail,
        };
      return {
        status: "ok",
        tokenHash: await options.accounts.completeLogin(result),
      };
    } catch (error) {
      return sendLoginError(reply, error);
    }
  });
  app.post("/api/auth/xy2api/login/2fa", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    let fingerprint = "";
    let acquired = false;
    try {
      const parsed = twoFactorSchema.safeParse(request.body);
      if (!parsed.success) {
        limit(request.ip);
        throw new Xy2apiError(400, "TWO_FACTOR_INVALID");
      }
      let challenge: z.infer<typeof challengeSchema>;
      try {
        challenge = challengeSchema.parse(
          JSON.parse(options.box.openSecret(parsed.data.challenge)),
        );
      } catch {
        limit(request.ip);
        throw new Xy2apiError(400, "TWO_FACTOR_INVALID");
      }
      limit(request.ip, challenge.email);
      fingerprint = createHash("sha256")
        .update(parsed.data.challenge)
        .digest("hex");
      if (
        challenge.exp <= Date.now() ||
        consumed.has(fingerprint) ||
        inFlight.has(fingerprint)
      )
        throw new Xy2apiError(400, "TWO_FACTOR_INVALID");
      inFlight.add(fingerprint);
      acquired = true;
      const result = await options.client.login2fa(
        challenge.tempToken,
        parsed.data.code,
      );
      consumed.set(fingerprint, challenge.exp);
      return {
        status: "ok",
        tokenHash: await options.accounts.completeLogin(result),
      };
    } catch (error) {
      return sendLoginError(reply, error, true);
    } finally {
      if (acquired) inFlight.delete(fingerprint);
    }
  });
  app.post("/api/auth/xy2api/logout", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user)
      return reply.code(401).send({
        error: {
          code: "xy2api_reauth_required",
          message: "登录已过期，请重新登录",
        },
      });
    await options.accounts.logout(user.id);
    return reply.code(204).send();
  });
}

function sendLoginError(
  reply: FastifyReply,
  error: unknown,
  twoFactor = false,
) {
  let code: keyof typeof messages = "xy2api_unavailable";
  let status = 503;
  if (error instanceof Xy2apiError) {
    if (error.status === 429) {
      code = "rate_limited";
      status = 429;
      reply.header("Retry-After", String(error.retryAfter));
    } else if (error.status === 403) {
      code = "account_disabled";
      status = 403;
    } else if (twoFactor && (error.status === 400 || error.status === 401)) {
      code = "two_factor_invalid";
      status = 400;
    } else if (error.status === 401) {
      code = "invalid_credentials";
      status = 401;
    } else if (error.id === "TURNSTILE_VERIFICATION_FAILED") {
      code = "captcha_failed";
      status = 400;
    }
  }
  if (error instanceof BillingGuardError)
    return reply
      .code(error.statusCode)
      .send({ error: { code: error.code, message: error.message } });
  return reply.code(status).send({ error: { code, message: messages[code] } });
}
