"use client";

/**
 * Main-site password login (F2). Flow:
 *   credentials (+ Turnstile) -> [TOTP] -> tokenHash -> supabase.verifyOtp
 *   -> fetchViewer (workspace bootstrap) -> navigate.
 * Secrets (password, TOTP challenge, tokenHash) only live in component
 * memory; nothing is written to storage or logs.
 */
import { ArrowLeftIcon, ArrowUpRightIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { ApiApplicationError, fetchViewer } from "../lib/server-api";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { cn } from "../lib/utils";
import {
  type AuthConfig,
  fetchAuthConfig,
  loginWithPassword,
  loginWithTotp,
} from "../lib/xy2api-api";
import { type TurnstileHandle, Turnstile } from "./auth/turnstile";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const ERROR_COPY: Record<string, string> = {
  invalid_credentials: "邮箱或密码不正确。",
  account_disabled: "这个主站账号暂时不可用，请联系主站客服。",
  captcha_failed: "人机验证没有通过，请重新验证后再登录。",
  two_factor_invalid: "验证码不正确或已过期，请输入验证器里最新的 6 位数字。",
  rate_limited: "尝试次数过多，请稍后再试。",
  xy2api_unavailable: "暂时连不上主站，请稍后再试。",
  verify_failed: "登录凭证校验失败，请重新登录。",
  bootstrap_failed: "账号已验证，但工作台没有准备好，请再试一次。",
};

type Step =
  | { kind: "credentials" }
  | { kind: "totp"; challenge: string; maskedEmail: string };

interface LoginFormProps {
  initialErrorMessage?: string | null;
  /** Where to go after a successful login (validated by the caller). */
  next?: string;
}

export function LoginForm({ initialErrorMessage = null, next = "/home" }: LoginFormProps) {
  const router = useRouter();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileBroken, setTurnstileBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialErrorMessage);
  const [retryIn, setRetryIn] = useState(0);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const loadConfig = useCallback(() => {
    setConfigError(false);
    fetchAuthConfig()
      .then(setConfig)
      .catch((err) => {
        console.error("[login] config unavailable", err);
        setConfigError(true);
      });
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Rate-limit countdown from Retry-After.
  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = setTimeout(() => setRetryIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [retryIn]);

  useEffect(() => {
    if (step.kind === "totp") codeRef.current?.focus();
  }, [step.kind]);

  const fail = useCallback((err: unknown) => {
    const code = err instanceof ApiApplicationError ? err.code : "xy2api_unavailable";
    if (err instanceof ApiApplicationError && code === "rate_limited") {
      setRetryIn(err.retryAfter ?? 60);
    }
    // Prefer our copy; fall back to the server's sanitized message.
    setError(
      ERROR_COPY[code] ??
        (err instanceof ApiApplicationError ? err.message : ERROR_COPY.xy2api_unavailable!),
    );
    turnstileRef.current?.reset();
  }, []);

  const finish = useCallback(
    async (tokenHash: string) => {
      const supabase = getSupabaseBrowserClient();
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        type: "magiclink",
        token_hash: tokenHash,
      });
      if (verifyError || !data.session?.access_token) {
        console.error("[login] verifyOtp failed", verifyError?.message);
        setError(ERROR_COPY.verify_failed!);
        return false;
      }
      try {
        await fetchViewer(data.session.access_token);
      } catch (err) {
        console.error("[login] viewer bootstrap failed", err);
        setError(ERROR_COPY.bootstrap_failed!);
        return false;
      }
      router.replace(next);
      return true;
    },
    [next, router],
  );

  const needsTurnstile = Boolean(config?.turnstileEnabled && config.turnstileSiteKey);
  const locked = retryIn > 0;
  const blocked = Boolean(config?.captchaUnsupported);

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || locked || blocked) return;
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setError("请输入主站邮箱和密码。");
      return;
    }
    if (needsTurnstile && !turnstileToken) {
      setError("请先完成人机验证。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await loginWithPassword({
        email: trimmed,
        password,
        ...(turnstileToken ? { turnstileToken } : {}),
      });
      if (result.status === "2fa_required") {
        setPassword("");
        setStep({
          kind: "totp",
          challenge: result.challenge,
          maskedEmail: result.maskedEmail,
        });
        return;
      }
      const ok = await finish(result.tokenHash);
      if (!ok) turnstileRef.current?.reset();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function submitTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.kind !== "totp" || busy || locked) return;
    if (!/^\d{6}$/.test(code)) {
      setError("请输入 6 位数字验证码。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await loginWithTotp({ challenge: step.challenge, code });
      await finish(result.tokenHash);
    } catch (err) {
      fail(err);
      setCode("");
      // An expired challenge cannot be retried; send the user back.
      if (err instanceof ApiApplicationError && err.code === "two_factor_invalid") {
        codeRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  }

  const backToCredentials = () => {
    setStep({ kind: "credentials" });
    setCode("");
    setError(null);
  };

  const submitLabel = locked
    ? `请等待 ${retryIn} 秒`
    : busy
      ? "正在登录"
      : "登录";

  return (
    <div className="w-full">
      {step.kind === "credentials" ? (
        <>
          <h1 className="font-display text-[44px] leading-[1.05] font-normal text-fg">
            登录
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-soft">
            使用{config?.siteName && config.siteName !== "主站" ? ` ${config.siteName} ` : "主站"}
            的账号和密码，余额与 Key 自动同步。
          </p>

          {blocked ? (
            <Notice tone="error" className="mt-6">
              主站开启了生图站暂不支持的验证码，暂时无法用账密登录，请联系管理员。
            </Notice>
          ) : null}
          {configError ? (
            <Notice tone="error" className="mt-6">
              暂时连不上登录服务。
              <button
                type="button"
                onClick={loadConfig}
                className="ml-1 font-medium text-fg underline underline-offset-4"
              >
                重试
              </button>
            </Notice>
          ) : null}

          <form onSubmit={submitCredentials} className="mt-8 flex flex-col gap-5" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">主站邮箱</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy || blocked}
                aria-invalid={error === ERROR_COPY.invalid_credentials || undefined}
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">密码</Label>
                {config?.forgotPasswordUrl ? (
                  <a
                    href={config.forgotPasswordUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[13px] text-fg-soft underline-offset-4 hover:text-fg hover:underline"
                  >
                    忘记密码
                  </a>
                ) : null}
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy || blocked}
                  className="pr-11"
                  aria-invalid={error === ERROR_COPY.invalid_credentials || undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-fg-muted transition-colors hover:text-fg"
                >
                  {showPassword ? (
                    <EyeOffIcon className="size-4" strokeWidth={1.75} />
                  ) : (
                    <EyeIcon className="size-4" strokeWidth={1.75} />
                  )}
                </button>
              </div>
            </div>

            {needsTurnstile && config ? (
              <div>
                <Turnstile
                  ref={turnstileRef}
                  siteKey={config.turnstileSiteKey}
                  onToken={setTurnstileToken}
                  onLoadError={() => setTurnstileBroken(true)}
                />
                {turnstileBroken ? (
                  <p className="mt-2 text-[13px] text-alert">
                    人机验证加载失败，请检查网络或关闭拦截插件后刷新页面。
                  </p>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <Notice tone="error" role="alert">
                {error}
              </Notice>
            ) : null}

            <Button
              type="submit"
              size="lg"
              variant="glow"
              disabled={busy || locked || blocked || (!config && !configError)}
              className="w-full"
            >
              {submitLabel}
            </Button>
          </form>

          <p className="mt-8 text-sm text-fg-soft">
            还没有主站账号？
            {config?.registerUrl ? (
              <a
                href={config.registerUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-1 inline-flex items-center gap-0.5 font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg"
              >
                去主站注册
                <ArrowUpRightIcon className="size-3.5" />
              </a>
            ) : (
              <span className="ml-1">请先到主站注册。</span>
            )}
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={backToCredentials}
            className="-ml-1 inline-flex items-center gap-1 rounded-sm px-1 text-sm text-fg-soft hover:text-fg"
          >
            <ArrowLeftIcon className="size-4" strokeWidth={1.75} />
            换个账号
          </button>
          <h1 className="mt-5 font-display text-[44px] leading-[1.05] font-normal text-fg">
            二次验证
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-soft">
            {step.maskedEmail} 开启了二次验证。打开验证器，输入 6 位动态码。
          </p>
          <form onSubmit={submitTotp} className="mt-8 flex flex-col gap-5" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="totp">动态验证码</Label>
              <Input
                id="totp"
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                disabled={busy}
                className="h-12 font-mono text-[22px] tracking-[0.5em]"
                aria-invalid={error === ERROR_COPY.two_factor_invalid || undefined}
              />
            </div>
            {error ? (
              <Notice tone="error" role="alert">
                {error}
              </Notice>
            ) : null}
            <Button
              type="submit"
              size="lg"
              variant="glow"
              disabled={busy || locked || code.length !== 6}
              className="w-full"
            >
              {locked ? `请等待 ${retryIn} 秒` : busy ? "正在验证" : "验证并登录"}
            </Button>
            <p className="text-[13px] text-fg-muted">验证码 5 分钟内有效，过期请返回重新登录。</p>
          </form>
        </>
      )}
    </div>
  );
}

function Notice({
  tone,
  children,
  className,
  role,
}: {
  tone: "error" | "info";
  children: React.ReactNode;
  className?: string;
  role?: string;
}) {
  return (
    <div
      role={role}
      className={cn(
        "rounded-[10px] border px-3.5 py-3 text-[13.5px] leading-relaxed",
        tone === "error"
          ? "border-alert/30 bg-alert-wash text-alert"
          : "border-line bg-white/[0.04] text-fg-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}
