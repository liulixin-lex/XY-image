"use client";

import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LoginView } from "../../components/auth/login-view";
import { buttonVariants } from "../../components/ui/button";
import { cn } from "../../lib/utils";
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
      <h1 className="font-display text-[48px] leading-[1.05] font-normal text-fg">
        注册在<em className="text-acc not-italic">主站</em>完成
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
            className={cn(buttonVariants({ variant: "accent", size: "poster", slant: true }), "w-full")}
          >
            <span className="sk-in">
              去主站注册
              <ArrowUpRightIcon className="size-[18px]" strokeWidth={2.2} />
            </span>
          </a>
        ) : null}
        <Link
          href="/login"
          className={cn(buttonVariants({ variant: "secondary", size: "lg", slant: true }), "w-full")}
        >
          <span className="sk-in">已有账号，去登录</span>
        </Link>
      </div>
    </LoginView>
  );
}
