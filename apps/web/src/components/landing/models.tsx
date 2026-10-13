"use client";

import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, type ReactNode, useRef } from "react";

import { BRAND } from "@/lib/brand";
import { KNOWN_IMAGE_MODELS } from "@/lib/image-model-meta";
import { DESKTOP_MOTION, MOTION_OK, ScrollTrigger, gsap, useGSAP } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { SAMPLE_ALT, type ShowcaseItem } from "./showcase";

/**
 * Ways to start (第 62 条): three cards that stack while you scroll — each
 * sticks a little lower than the one before and the one underneath shrinks
 * back as the next slides over it (DESKTOP_MOTION; phones get a plain
 * column). The miniature controls on each card are pictures of the product,
 * not controls: aria-hidden and inert; the real ones are one click away.
 *
 * TODO(agent01): keep these sentences in step with the studio (multi-model,
 * 局部重绘 / 扩图), the canvas (agent tool cap per turn) and templates /
 * brand kits (第 58 条).
 */
export function FeaturesSection({ samples, signedIn }: { samples: ShowcaseItem[]; signedIn: boolean }) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(DESKTOP_MOTION, () => {
        const cards = gsap.utils.toArray<HTMLElement>("[data-stack-card]", root.current);
        cards.forEach((card, index) => {
          const next = cards[index + 1];
          const body = card.querySelector<HTMLElement>("[data-stack-body]");
          if (!next || !body) return;
          // As the next card slides over, this one sinks back and dims.
          gsap.to(body, {
            scale: 0.93,
            yPercent: -2,
            ease: "none",
            scrollTrigger: {
              trigger: next,
              start: "top bottom",
              end: () => `top ${104 + (index + 1) * 22}px`,
              scrub: true,
              invalidateOnRefresh: true,
            },
          });
          const veil = card.querySelector<HTMLElement>("[data-stack-veil]");
          if (veil)
            gsap.fromTo(
              veil,
              { opacity: 0 },
              {
                opacity: 1,
                ease: "none",
                scrollTrigger: {
                  trigger: next,
                  start: "top bottom",
                  end: () => `top ${104 + (index + 1) * 22}px`,
                  scrub: true,
                  invalidateOnRefresh: true,
                },
              },
            );
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  const studio = samples.slice(0, 4);
  const board = samples.slice(4, 7);
  const kit = samples.slice(7, 9);
  return (
    <section ref={root} id="features" aria-labelledby="features-title" className="relative z-10 scroll-mt-20 py-24 lg:py-32">
      <div className="mx-auto max-w-[1600px] px-5 sm:px-8 lg:px-[clamp(24px,3.6vw,64px)]">
        <h2 id="features-title" className="font-display text-[clamp(44px,5vw,80px)] leading-[1.02] font-normal text-fg">
          三种开始方式
        </h2>

        <div className="mt-12 flex flex-col gap-6 lg:gap-10 lg:pb-[8vh]">
          <StackCard
            index={0}
            sticker="生图"
            title="一句话出图"
            body="写一句描述，选比例和画质，一次出多张，也可以几个模型同时出图对比。满意的那张接着改：做参考、出变体、局部重绘或扩图。"
            href={signedIn ? "/studio" : "/login?next=%2Fstudio"}
            link="打开生图"
          >
            <StudioMini samples={studio} />
          </StackCard>
          <StackCard
            index={1}
            sticker="画布"
            title={`画布和${BRAND.agentName}`}
            body={`在无限画布上跟${BRAND.agentName}说需求，它会先想好画面，再连续出图、排到画布上。也可以自己用节点，把描述、参考图和生成连起来。`}
            href={signedIn ? "/projects" : "/login?next=%2Fprojects"}
            link="打开画布"
          >
            <NodeBoard board={board} />
          </StackCard>
          <StackCard
            index={2}
            sticker="模板"
            title="模板和品牌套件"
            body="不会写描述，就从模板开始，填几个空就是一段完整的描述。选上品牌套件，每张图都带上你的配色和标志。"
            href={signedIn ? "/studio" : "/login?next=%2Fstudio"}
            link="去生图页用模板"
          >
            <TemplateMini samples={kit} />
          </StackCard>
        </div>
      </div>
    </section>
  );
}

function StackCard({
  index,
  sticker,
  title,
  body,
  href,
  link,
  children,
}: {
  index: number;
  sticker: string;
  title: string;
  body: string;
  href: string;
  link: string;
  children: ReactNode;
}) {
  return (
    <article
      data-stack-card
      className="stack-card"
      style={{ "--stack-i": index } as CSSProperties}
    >
      <div
        data-stack-body
        className="relative grid origin-top grid-cols-1 overflow-hidden rounded-[24px] bg-panel shadow-[0_2px_4px_var(--shadow),0_40px_80px_-40px_var(--shadow-2)] lg:min-h-[min(68dvh,600px)] lg:grid-cols-12"
      >
        <div className="relative flex flex-col p-7 sm:p-9 lg:col-span-5 lg:p-12">
          <Sticker>{sticker}</Sticker>
          <h3 className="mt-5 font-display text-[clamp(30px,2.8vw,44px)] leading-tight font-normal text-fg">{title}</h3>
          <p className="mt-4 max-w-[30em] text-[15.5px] leading-relaxed text-fg-soft">{body}</p>
          <ModeLink href={href}>{link}</ModeLink>
        </div>
        <div aria-hidden className="pointer-events-none relative min-h-[300px] select-none p-5 sm:p-7 lg:col-span-7 lg:p-10 lg:pl-0">
          {children}
        </div>
        {/* Dims the card as the next one covers it (scrubbed, opacity only). */}
        <div data-stack-veil aria-hidden className="pointer-events-none absolute inset-0 bg-ground/55 opacity-0" />
      </div>
    </article>
  );
}

function Sticker({ children }: { children: string }) {
  return (
    <span className="inline-flex w-fit -rotate-3 rounded-[9px] bg-acc px-3 py-1.5 font-display text-[16px] leading-none text-acc-ink shadow-acc">
      {children}
    </span>
  );
}

function ModeLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="group mt-auto inline-flex w-fit items-center gap-1.5 rounded-md pt-8 text-[15px] font-semibold text-fg underline decoration-line-strong underline-offset-[6px] transition-colors hover:decoration-acc"
    >
      {children}
      <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
    </Link>
  );
}

function Thumb({ item, className, style }: { item: ShowcaseItem; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("sk-frame aspect-[3/4] rounded-[12px]", className)} style={style}>
      {/* biome-ignore lint/performance/noImgElement: static export */}
      <img
        src={item.src}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
        style={{ objectPosition: item.focus }}
      />
    </div>
  );
}

/** The studio in miniature: a batch of four, its settings and the coral action. */
function StudioMini({ samples }: { samples: ShowcaseItem[] }) {
  return (
    <div className="flex h-full flex-col justify-center rounded-[18px] bg-well p-5 sm:p-7">
      <div className="grid grid-cols-4 gap-3">
        {samples.map((item, index) => (
          <Thumb
            key={item.id}
            item={item}
            className={index === 0 ? "ring-picked" : "shadow-[0_14px_24px_-16px_var(--shadow-2)]"}
          />
        ))}
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-2">
        {["3:4", "4K", "质量高", "GPT Image 2.5"].map((chip) => (
          <span
            key={chip}
            className="sk inline-flex h-[30px] items-center rounded-[9px] bg-tint/[0.06] px-3 text-[12.5px] font-semibold text-fg-soft tabular"
          >
            <span className="sk-in">{chip}</span>
          </span>
        ))}
        <span className="sk ml-auto inline-flex h-11 items-center rounded-[12px] bg-acc px-5 font-display text-[18px] text-acc-ink shadow-acc">
          <span className="sk-in gap-1">
            生成<span className="numeral text-[22px]">4</span>张
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * A miniature node canvas: a prompt node wired to a generate node, wired to
 * three results, on a dotted board (a real canvas, so the dots are earned).
 */
function NodeBoard({ board }: { board: ShowcaseItem[] }) {
  return (
    <div className="relative h-full min-h-[320px] overflow-hidden rounded-[18px] bg-well bg-[radial-gradient(rgb(var(--tint)/0.14)_1px,transparent_1px)] [background-size:20px_20px]">
      <svg viewBox="0 0 700 320" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" fill="none" strokeWidth="2">
        <path d="M206 102 C 250 102, 240 160, 286 160" stroke="var(--acc)" />
        <path d="M402 160 C 440 160, 436 73, 474 73" stroke="var(--line-strong)" />
        <path d="M402 160 C 480 160, 520 156, 586 156" stroke="var(--line-strong)" />
        <path d="M402 160 C 440 160, 436 246, 474 246" stroke="var(--line-strong)" />
      </svg>
      <div className="glass absolute top-[18%] left-[3%] w-[27%] rounded-[12px] p-3">
        <span className="poster-label text-[13px] text-fg">描述</span>
        <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-[1.55] text-fg-soft">{board[0]?.title}</p>
      </div>
      <div className="absolute top-[41%] left-[41%] flex h-[19%] min-w-[16.5%] items-center justify-center gap-1 rounded-[12px] bg-fg px-3 font-display text-[15px] whitespace-nowrap text-ground shadow-[0_14px_24px_-14px_var(--shadow-2)]">
        生成<span className="numeral text-[18px]">×3</span>
      </div>
      {board.map((item, index) => (
        <figure
          key={item.id}
          className="sk-frame absolute m-0 aspect-[3/4] w-[13%] rounded-[10px] shadow-[0_14px_24px_-14px_var(--shadow-2)]"
          style={BOARD_LAYOUT[index]}
        >
          {/* biome-ignore lint/performance/noImgElement: static export */}
          <img
            src={item.src}
            alt={`${SAMPLE_ALT}：${item.title}`}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            style={{ objectPosition: item.focus }}
          />
        </figure>
      ))}
      <div className="glass-strong absolute right-[3%] bottom-[5%] max-w-[min(250px,44%)] rounded-[14px] rounded-br-[4px] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-fg">
        再来三张，换成冷色调
      </div>
    </div>
  );
}

/** Where the three results sit on the board (fractions of 700×320). */
const BOARD_LAYOUT: CSSProperties[] = [
  { left: "68%", top: "4%" },
  { left: "84%", top: "30%" },
  { left: "68%", top: "58%" },
];

/** A template filled in, and a brand kit's colours, each next to its picture. */
function TemplateMini({ samples }: { samples: ShowcaseItem[] }) {
  const [first, second] = samples;
  return (
    <div className="grid h-full grid-cols-2 gap-4 rounded-[18px] bg-well p-5 sm:p-7">
      <div className="flex flex-col gap-3">
        <div className="rounded-[14px] bg-panel p-4 shadow-[0_10px_24px_-18px_var(--shadow-2)]">
          <span className="poster-label text-[13px] text-fg">写实人像</span>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px]">
            <dt className="text-fg-muted">人物</dt>
            <dd className="truncate text-fg">短发女孩，琥珀色眼睛</dd>
            <dt className="text-fg-muted">光线</dt>
            <dd className="truncate text-fg">黄金时刻逆光</dd>
            <dt className="text-fg-muted">镜头感</dt>
            <dd className="truncate text-fg">85mm 人像</dd>
          </dl>
        </div>
        {first ? <Thumb item={first} className="w-[78%] self-end shadow-[0_18px_30px_-18px_var(--shadow-2)]" /> : null}
      </div>
      <div className="flex flex-col gap-3">
        {second ? <Thumb item={second} className="w-[78%] shadow-[0_18px_30px_-18px_var(--shadow-2)]" /> : null}
        <div className="rounded-[14px] bg-panel p-4 shadow-[0_10px_24px_-18px_var(--shadow-2)]">
          <span className="poster-label text-[13px] text-fg">品牌套件</span>
          <div className="mt-3 flex gap-1.5">
            {["#d4412a", "#24212b", "#f1e3d3", "#2f6f68", "#e9b44c"].map((colour) => (
              <span key={colour} className="h-7 flex-1 rounded-[6px]" style={{ background: colour }} />
            ))}
          </div>
          <p className="mt-2.5 text-[12px] text-fg-muted">配色 · 标志 · 调性</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Models the main site can route to. The heading sticks while the list goes
 * by; rows wipe in once as a list. Only the note that sets a model apart is
 * shown (「效果优先」); resolution and quality tiers live in the studio's
 * pickers, where they apply (第 62 条).
 */
export function ModelsSection() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const rows = gsap.utils.toArray<HTMLElement>("[data-model-row]", root.current);
        gsap.set(rows, { clipPath: "inset(0 100% 0 0)", x: -16 });
        ScrollTrigger.batch(rows, {
          start: "top 88%",
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, {
              clipPath: "inset(0 0% 0 0)",
              x: 0,
              duration: 0.8,
              ease: "expo.out",
              stagger: 0.06,
              clearProps: "clipPath,transform",
            }),
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} id="models" aria-labelledby="models-title" className="relative z-10 scroll-mt-20 pb-24 lg:pb-32">
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-10 px-5 sm:px-8 lg:grid-cols-12 lg:px-[clamp(24px,3.6vw,64px)]">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            <h2 id="models-title" className="font-display text-[clamp(36px,3.6vw,56px)] leading-tight font-normal text-fg">
              能用哪些模型
            </h2>
            <p className="mt-3 max-w-[24em] text-[15px] leading-relaxed text-fg-soft">
              以你的 Key 所在分组为准。
            </p>
          </div>
        </div>
        <ul className="divide-y divide-line border-y border-line lg:col-span-8">
          {KNOWN_IMAGE_MODELS.map((model) => (
            <li
              key={model.id}
              data-model-row
              className="group flex items-baseline gap-3 py-5 transition-colors"
            >
              <span
                aria-hidden
                className="font-display text-[18px] text-acc opacity-0 transition-[opacity,translate] duration-300 group-hover:translate-x-0 group-hover:opacity-100 -translate-x-2"
              >
                /
              </span>
              <span className="text-[clamp(19px,1.6vw,24px)] leading-tight font-bold tracking-[-0.01em] text-fg transition-transform duration-300 group-hover:translate-x-1">
                {model.displayName}
              </span>
              <span className="text-[13px] text-fg-muted">{model.maker}</span>
              {model.note ? <span className="ml-auto text-[13.5px] font-medium text-fg-soft">{model.note}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
