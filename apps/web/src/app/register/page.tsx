"use client";

import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LoginView } from "../../components/auth/login-view";
import { getXy2apiWebUrl } from "../../lib/env";
import { fetchAuthConfig } from "../../lib/xy2api-api";

/**
 * Accounts are created on the xy2api main site only. This route stays so
 * old links do not 404; it points to the main-site register page.
 */
export default function RegisterPage() {
  const fallback = getXy2apiWebUrl();
  const [registerUrl, setRegisterUrl] = useState<string | null>(
    fallback ? `${fallback}/register` : null,
  );

  useEffect(() => {
    fetchAuthConfig()
      .then((config) => setRegisterUrl(config.registerUrl))
      .catch(() => {});
  }, []);

  return (
    <LoginView>
      <h1 className="font-display text-[44px] leading-[1.05] font-normal text-fg">
        注册在主站完成
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-fg-soft">
        GGUU AI IMAGE 使用主站账号登录，生成费用从主站余额扣除。先在主站注册并充值，再回来用同一组邮箱和密码登录。
      </p>
      <div className="mt-8 flex flex-col gap-3">
        {registerUrl ? (
          <a
            href={registerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-fg px-5 text-[15px] font-semibold text-ground glow-amb transition-colors hover:bg-white"
          >
            去主站注册
            <ArrowUpRightIcon className="size-4" />
          </a>
        ) : null}
        <Link
          href="/login"
          className="inline-flex h-11 items-center justify-center rounded-xl border border-line-strong bg-white/[0.04] px-5 text-[15px] font-medium text-fg transition-colors hover:bg-white/[0.1]"
        >
          已有账号，去登录
        </Link>
      </div>
    </LoginView>
  );
}
