"use client";

import { ArrowUpRightIcon, LogOutIcon, RotateCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { displayNameOf, useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";

import { BalanceFigure } from "../account/balance";
import { Button, buttonVariants } from "../ui/button";
import { Fact, Facts, SettingsSection } from "./section";

/**
 * Who is signed in and what they bill against. Everything here is owned by
 * the main site; this tab only reads it and links out.
 */
export function AccountTab() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { account, refreshAccount } = useAccount();
  const [refreshing, setRefreshing] = useState(false);
  const data = account.data;
  const links = data?.links;

  const refresh = async () => {
    setRefreshing(true);
    await refreshAccount({ force: true });
    setRefreshing(false);
  };

  return (
    <div>
      <SettingsSection
        title="主站账号"
        description="GGUU AI IMAGE 用你的主站账号登录。用户名、邮箱和密码都在主站修改。"
      >
        {data ? (
          <Facts>
            <Fact label="显示名">{displayNameOf(data)}</Fact>
            <Fact label="邮箱">{data.user.email}</Fact>
            <Fact label="主站用户 ID">
              <span className="font-mono text-[12.5px] tabular">{data.user.xy2apiUserId}</span>
            </Fact>
          </Facts>
        ) : account.error ? (
          <p className="text-[13.5px] text-fg-soft">账号信息暂时读不到。</p>
        ) : (
          <div className="space-y-2.5" aria-label="读取中">
            <div className="h-4 w-48 animate-breathe rounded-sm" />
            <div className="h-4 w-64 animate-breathe rounded-sm" />
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="余额"
        description="余额和用量明细以主站为准。"
      >
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <BalanceFigure
              className="block text-[40px] leading-none"
              emptyLabel={data && data.preferences.image_key_id === null ? "未选择 Key" : "暂不可读"}
            />
            {data?.balance?.planName ? (
              <p className="mt-2 text-[12.5px] text-fg-soft">{data.balance.planName}</p>
            ) : data && !data.balance ? (
              <p className="mt-2 max-w-[44ch] text-[12.5px] leading-relaxed text-fg-soft">
                余额通过所选的生图 Key 读取。先在「Key」里选一个可用的生图 Key。
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}>
            <RotateCwIcon className={refreshing ? "animate-spin" : undefined} strokeWidth={1.75} />
            刷新
          </Button>
        </div>
        {links ? (
          <div className="mt-6 flex flex-wrap gap-2">
            <a href={links.recharge} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "accent" })}>
              去主站充值
              <ArrowUpRightIcon strokeWidth={1.75} />
            </a>
            <a href={links.usage} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
              主站用量明细
              <ArrowUpRightIcon strokeWidth={1.75} />
            </a>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title="登录状态" description="退出后，这台设备需要重新用主站账号登录。">
        <Button
          variant="outline"
          onClick={async () => {
            await signOut();
            router.replace("/login");
          }}
        >
          <LogOutIcon strokeWidth={1.75} />
          退出登录
        </Button>
      </SettingsSection>
    </div>
  );
}
