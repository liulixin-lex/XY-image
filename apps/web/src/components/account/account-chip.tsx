"use client";

import {
  ArrowUpRightIcon,
  KeyRoundIcon,
  LogOutIcon,
  ReceiptTextIcon,
  WalletIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { displayNameOf, useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { BalanceFigure } from "./balance";

/**
 * Top-right account control: the main-site balance with a recharge link,
 * and an avatar that opens the account menu (balance, usage, keys, sign
 * out). On phones only the avatar shows; the menu carries the balance.
 */
export function AccountChip({ className }: { className?: string }) {
  const router = useRouter();
  const { signOut } = useAuth();
  const { account } = useAccount();
  const data = account.data;
  const name = displayNameOf(data);
  const initial = (name || "·").slice(0, 1).toUpperCase();
  const noKey = Boolean(data && !data.balance);

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {/* Below xl the centred nav needs the room; the popover still shows the balance. */}
      <div className="glass hidden h-10 items-center gap-2.5 rounded-[12px] pr-1.5 pl-3.5 sm:flex md:hidden xl:flex">
        <span className="text-[13px] text-fg-muted">主站余额</span>
        <BalanceFigure emptyLabel={noKey ? "未选 Key" : "暂不可读"} className="text-[15px]" />
        {data?.links.recharge ? (
          <a
            href={data.links.recharge}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1 rounded-[8px] bg-white/[0.06] px-2.5 text-[12.5px] font-medium text-fg-soft transition-colors hover:bg-white/[0.12] hover:text-fg"
          >
            充值
            <ArrowUpRightIcon className="size-3.5" strokeWidth={1.75} />
          </a>
        ) : (
          <span className="w-1" aria-hidden />
        )}
      </div>
      <Popover>
      <PopoverTrigger
        className="flex size-9 items-center justify-center rounded-full bg-[linear-gradient(140deg,rgb(var(--amb)),rgb(var(--amb-2)))] text-[14px] font-semibold text-ground-deep shadow-[0_0_0_2px_rgb(255_255_255/0.15)] transition-[box-shadow,background] duration-700 outline-none hover:shadow-[0_0_0_2px_rgb(255_255_255/0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amb data-popup-open:shadow-[0_0_0_2px_rgb(255_255_255/0.5)]"
        aria-label="账户与余额"
      >
        {initial}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-0">
        <div className="border-b border-line px-4 py-3.5">
          <p className="truncate text-sm font-semibold text-fg">{name || "主站账号"}</p>
          {data?.user.email && data.user.username ? (
            <p className="mt-0.5 truncate text-xs text-fg-muted">{data.user.email}</p>
          ) : null}
        </div>
        <div className="px-4 py-4">
          <p className="text-xs text-fg-muted">主站余额</p>
          <BalanceFigure
            className="mt-1.5 block text-[30px] leading-none"
            emptyLabel={noKey ? "未选择 Key" : "暂不可读"}
          />
          {noKey ? (
            <p className="mt-2 text-xs leading-relaxed text-fg-soft">
              选择一个能生图的 Key 后才能读取余额。
            </p>
          ) : data?.balance?.planName ? (
            <p className="mt-2 text-xs text-fg-soft">{data.balance.planName}</p>
          ) : null}
        </div>
        <div className="flex flex-col border-t border-line p-1.5">
          {data?.links.recharge ? (
            <MenuLink href={data.links.recharge} icon={<WalletIcon />} label="去主站充值" external />
          ) : null}
          {data?.links.usage ? (
            <MenuLink href={data.links.usage} icon={<ReceiptTextIcon />} label="主站用量明细" external />
          ) : null}
          <MenuButton
            icon={<KeyRoundIcon />}
            label={noKey ? "选择 Key" : "Key 与模型"}
            onClick={() => router.push("/settings?tab=keys")}
            emphasis={noKey}
          />
          <MenuButton
            icon={<LogOutIcon />}
            label="退出登录"
            onClick={async () => {
              await signOut();
              router.replace("/login");
            }}
          />
        </div>
      </PopoverContent>
      </Popover>
    </div>
  );
}

const itemClass =
  "flex h-9 items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] text-fg transition-colors hover:bg-white/[0.08] [&_svg]:size-4 [&_svg]:text-fg-muted [&_svg]:stroke-[1.75]";

function MenuLink({
  href,
  icon,
  label,
  external,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={itemClass}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {external ? <ArrowUpRightIcon className="!size-3.5" /> : null}
    </a>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  emphasis,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  emphasis?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className={cn(itemClass, "text-left")}>
      {icon}
      <span className={cn("flex-1", emphasis && "font-semibold text-alert")}>{label}</span>
    </button>
  );
}
