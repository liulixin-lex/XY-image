import { KeyRoundIcon, ReceiptTextIcon, WalletIcon } from "lucide-react";

import { BillingBadge } from "../billing/billing-badge";
import { SAMPLE_ALT, type ShowcaseItem } from "./showcase";

const FACTS = [
  {
    icon: KeyRoundIcon,
    title: "主站账号直接登录",
    body: "邮箱密码、二次验证都和主站一样，不用另外注册。注册和找回密码在主站完成。",
  },
  {
    icon: WalletIcon,
    title: "按次从主站余额扣费",
    body: "没有积分，也没有套餐。价格按你的 Key 所在分组计算，直接从主站美元余额里扣。",
  },
  {
    icon: ReceiptTextIcon,
    title: "每一笔都查得到",
    body: "每张图都带主站请求 ID。连接中断时会标成「待核对」，不会自动重发，也不会当成没扣费。",
  },
];

/** Billing truth, shown with the same record a finished picture carries. */
export function BillingSection({ sample }: { sample: ShowcaseItem }) {
  return (
    <section id="billing" aria-labelledby="billing-title" className="relative z-10 scroll-mt-20 py-24 lg:py-32">
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-16 px-5 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:px-[clamp(24px,3.6vw,64px)]">
        <div className="lg:col-span-5">
          <h2 id="billing-title" className="font-display text-[clamp(44px,5.4vw,84px)] leading-[1.04] font-normal text-fg">
            和主站共用
            <br />
            <em className="text-acc not-italic">一个账号</em>
            <br />
            一份余额
          </h2>
          <dl className="mt-12 divide-y divide-line border-y border-line">
            {FACTS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="grid grid-cols-[2.75rem_1fr] gap-x-4 py-6">
                <span className="sk flex size-11 items-center justify-center rounded-[12px] bg-acc-soft text-acc-text">
                  <Icon className="sk-in size-[19px]" strokeWidth={1.9} />
                </span>
                <div>
                  <dt className="text-[17px] font-semibold text-fg">{title}</dt>
                  <dd className="mt-1.5 max-w-[32em] text-[15px] leading-relaxed text-fg-soft">{body}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>

        <figure className="relative m-0 lg:col-span-6 lg:col-start-7">
          <div className="relative mx-auto w-[min(100%,400px)] lg:mr-[20%]">
            <div className="absolute inset-0 translate-x-[7%] translate-y-[4%]">
              <div className="sk h-full w-full rounded-[22px] bg-[rgb(var(--amb)/0.45)]" />
            </div>
            <div className="sk-frame shadow-lit relative aspect-[3/4] rounded-[22px]">
              {/* biome-ignore lint/performance/noImgElement: static export */}
              <img
                src={sample.src}
                alt={`${SAMPLE_ALT}：${sample.prompt}`}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
                style={{ objectPosition: sample.focus }}
              />
            </div>
            <div className="glass-strong absolute -bottom-12 left-4 w-[min(330px,calc(100vw-56px))] rotate-[1.5deg] rounded-[18px] p-5 sm:left-auto sm:-right-[24%]">
              <p className="text-[14px] leading-relaxed font-medium text-fg">{sample.prompt}</p>
              <dl className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-[13px]">
                <dt className="text-fg-muted">模型</dt>
                <dd className="text-right text-fg">GPT Image 2</dd>
                <dt className="text-fg-muted">尺寸</dt>
                <dd className="text-right text-fg tabular">2K · {sample.ratio}</dd>
                <dt className="text-fg-muted">扣费</dt>
                <dd className="text-right">
                  <BillingBadge status="charged" />
                </dd>
                <dt className="text-fg-muted">请求 ID</dt>
                <dd className="truncate text-right font-mono text-[12px] text-fg">req_4c1e9a07…b2</dd>
              </dl>
              <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-fg-soft">
                在主站账单里搜这个 ID 就能找到这一笔。
              </p>
            </div>
          </div>
          <figcaption className="mt-20 text-center text-xs text-fg-muted lg:text-left">示例记录</figcaption>
        </figure>
      </div>
    </section>
  );
}
