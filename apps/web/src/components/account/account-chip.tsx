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

import { ThemeToggle } from "../theme-toggle";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { BalanceFigure } from "./balance";

/**
 * Top-right account control: the main-site balance in poster numerals with
 * a recharge link, the theme switch, and a coral slanted avatar that opens
 * the account menu (balance, usage, keys, sign out). On phones only the
 * avatar shows; the menu carries the balance.
 */
export function AccountChip({ className }: { className?: string }) {
  const router = useRouter();
  const { signOut } = useAuth();
  const { account } = useAccount();
  const data = account.data;
  const name = displayNameOf(data);
  const initial = (name || "·").slice(0, 1).toUpperCase();
  // A selected key with an unreadable balance is "暂不可读", not "未选 Key".
  const noKey = Boolean(data && !data.balance && data.preferences.image_key_id === null);

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {/* Below xl the centred nav needs the room; the popover still shows the balance. */}
      {/* Below xl the tabs need the room; the popover still shows the balance. */}
      <div className="hidden items-center gap-2 sm:flex md:hidden xl:flex">
        <span className="text-[13px] text-fg-muted">余额</span>
        <BalanceFigure numeral emptyLabel={noKey ? "未选 Key" : "暂不可读"} className="text-[22px]" />
        {data?.links.recharge ? (
          <a
            href={data.links.recharge}
            target="_blank"
            rel="noreferrer"
            className="sk ml-1 inline-flex h-7 items-center rounded-[8px] bg-acc-soft px-2.5 text-[12.5px] font-semibold text-acc-text transition-colors hover:bg-acc hover:text-acc-ink"
          >
            <span className="sk-in gap-0.5">
              充值
              <ArrowUpRightIcon className="size-3.5" strokeWidth={2} />
            </span>
          </a>
        ) : null}
      </div>
      <ThemeToggle />
      <Popover>
      <PopoverTrigger
        className="sk flex h-9 w-10 items-center justify-center rounded-[10px] bg-acc font-display text-[17px] text-acc-ink shadow-acc transition-[background-color,scale] outline-none hover:bg-acc-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:scale-95"
        aria-label="账户与余额"
      >
        <span className="sk-in">{initial}</span>
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
            numeral
            className="mt-1.5 block text-[44px]"
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
  "flex h-9 items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] text-fg transition-colors hover:bg-tint/[0.08] [&_svg]:size-4 [&_svg]:text-fg-muted [&_svg]:stroke-[1.75]";

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
