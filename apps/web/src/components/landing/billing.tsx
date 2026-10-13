"use client";

import { KeyRoundIcon, ReceiptTextIcon, WalletIcon } from "lucide-react";
import { useRef } from "react";

import { DESKTOP_MOTION, MOTION_OK, gsap, useGSAP } from "@/lib/motion";

import { RevealHeading } from "./reveal-heading";
import { SAMPLE_ALT, SAMPLE_MODEL, type ShowcaseItem } from "./showcase";

const FACTS = [
  {
    icon: KeyRoundIcon,
    title: "主站账号直接登录",
    body: "用主站的邮箱和密码登录，不用另外注册。",
  },
  {
    icon: WalletIcon,
    title: "从主站余额支付",
    body: "没有积分和套餐，按你的 Key 所在分组的价格计算。",
  },
  {
    icon: ReceiptTextIcon,
    title: "每一笔都查得到",
    body: "每张图都带主站请求 ID，在主站用量明细里能对上。",
  },
];

const REQUEST_ID = "req_4c1e9a07…b2";

/**
 * 计费说明, the one place the site talks about money (DESIGN.md). The picture
 * and its colour slab drift at different speeds as the section passes
 * (scrubbed parallax); the record card tilts up flat as it arrives and its
 * request id types itself in once. Reduced motion: all of it static.
 */
export function BillingSection({ sample }: { sample: ShowcaseItem }) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(DESKTOP_MOTION, () => {
        const scrub = { trigger: root.current, start: "top bottom", end: "bottom top", scrub: 0.6 };
        gsap.fromTo("[data-bill-photo]", { yPercent: 6 }, { yPercent: -6, ease: "none", scrollTrigger: scrub });
        gsap.fromTo("[data-bill-slab]", { yPercent: 14 }, { yPercent: -10, ease: "none", scrollTrigger: scrub });
      });
      mm.add(MOTION_OK, () => {
        const card = root.current?.querySelector<HTMLElement>("[data-bill-card]");
        const id = root.current?.querySelector<HTMLElement>("[data-bill-id]");
        if (!card || !id) return;
        const tl = gsap.timeline({
          scrollTrigger: { trigger: card, start: "top 85%", once: true },
        });
        tl.from(card, {
          rotationX: 38,
          y: 40,
          opacity: 0,
          transformPerspective: 900,
          transformOrigin: "50% 100%",
          duration: 0.9,
          ease: "expo.out",
        });
        // The id types in, one character at a time.
        const counter = { n: 0 };
        tl.fromTo(
          counter,
          { n: 0 },
          {
            n: REQUEST_ID.length,
            duration: 0.7,
            ease: "none",
            onUpdate: () => {
              id.textContent = REQUEST_ID.slice(0, Math.round(counter.n)) || " ";
            },
          },
          "-=0.35",
        );
        return () => {
          id.textContent = REQUEST_ID;
        };
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} id="billing" aria-labelledby="billing-title" className="relative z-10 scroll-mt-20 py-24 lg:py-32">
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-16 px-5 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:px-[clamp(24px,3.6vw,64px)]">
        <div className="lg:col-span-5">
          <RevealHeading id="billing-title" className="font-display text-[clamp(44px,5vw,80px)] leading-[1.04] font-normal text-fg">
            和主站共用
            <br />
            <em className="text-acc not-italic">一个账号</em>
            <br />
            一份余额
          </RevealHeading>
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
            <div data-bill-slab aria-hidden className="absolute inset-0 translate-x-[7%] translate-y-[4%]">
              <div className="sk h-full w-full rounded-[22px] bg-[rgb(var(--amb)/0.45)]" />
            </div>
            <div data-bill-photo className="sk-frame shadow-lit relative aspect-[3/4] rounded-[22px]">
              {/* biome-ignore lint/performance/noImgElement: static export */}
              <img
                src={sample.src}
                srcSet={`${sample.src} 600w, ${sample.large} 1200w`}
                sizes="(min-width: 1024px) 400px, 90vw"
                alt={`${SAMPLE_ALT}：${sample.title}`}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
                style={{ objectPosition: sample.focus }}
              />
            </div>
            <div
              data-bill-card
              className="glass-strong absolute -bottom-12 left-4 w-[min(330px,calc(100vw-56px))] rotate-[1.5deg] rounded-[18px] p-5 sm:left-auto sm:-right-[24%]"
            >
              <p className="line-clamp-2 text-[14px] leading-relaxed font-medium text-fg">{sample.title}</p>
              <dl className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-[13px]">
                <dt className="text-fg-muted">模型</dt>
                <dd className="text-right text-fg">{SAMPLE_MODEL}</dd>
                <dt className="text-fg-muted">尺寸</dt>
                <dd className="text-right text-fg tabular">4K · {sample.ratio}</dd>
                <dt className="text-fg-muted">请求 ID</dt>
                <dd data-bill-id className="truncate text-right font-mono text-[12px] text-fg">
                  {REQUEST_ID}
                </dd>
              </dl>
              <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-fg-soft">在主站用量明细里搜这个 ID。</p>
            </div>
          </div>
          <figcaption className="mt-20 text-center text-xs text-fg-muted lg:text-left">示例记录</figcaption>
        </figure>
      </div>
    </section>
  );
}
