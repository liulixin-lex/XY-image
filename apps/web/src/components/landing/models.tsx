import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { BRAND } from "@/lib/brand";
import { KNOWN_IMAGE_MODELS } from "@/lib/image-model-meta";
import { cn } from "@/lib/utils";

import { SAMPLE_ALT, type ShowcaseItem } from "./showcase";

/**
 * The two ways to work (the 生图 page, or the node canvas with the
 * assistant), each shown as a small poster of its own screen, then the list
 * of models the main site can route to.
 *
 * The miniature controls are pictures of the product, not controls: they
 * are aria-hidden and inert. The real ones are one click away.
 * TODO(agent01): keep these sentences in step with the studio (batch size,
 * prompt rewrite, 局部重绘 / 扩图 from M-G, which Grok models cannot do) and
 * the canvas (agent cap per turn; the node wording assumes the M-D node
 * canvas).
 */
export function ModesSection({ samples, signedIn }: { samples: ShowcaseItem[]; signedIn: boolean }) {
  const batch = samples.slice(0, 4);
  const board = samples.slice(4, 7);
  return (
    <section id="models" aria-labelledby="models-title" className="relative z-10 scroll-mt-20 py-24 lg:py-32">
      <div className="mx-auto max-w-[1600px] px-5 sm:px-8 lg:px-[clamp(24px,3.6vw,64px)]">
        <h2 id="models-title" className="font-display text-[clamp(44px,5.4vw,84px)] leading-[1.02] font-normal text-fg">
          两种创作方式
        </h2>

        <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <article className="glass relative flex flex-col overflow-hidden rounded-[20px] p-7 sm:p-9 lg:col-span-5">
            <Sticker>生图</Sticker>
            <h3 className="mt-5 font-display text-[clamp(30px,2.6vw,40px)] leading-tight font-normal text-fg">一句话出图</h3>
            <p className="mt-3 max-w-[30em] text-[15px] leading-relaxed text-fg-soft">
              写一句描述，选比例、画质（1K 到 4K）、质量和张数，一次出 1 到 4 张。描述太短可以先让它帮你写具体；满意的那张接着改：以它为参考、做变体，或者涂出一块重画、把画面往外扩。
            </p>
            <div aria-hidden className="pointer-events-none relative mt-9 flex-1 select-none">
              <div className="grid grid-cols-4 gap-2.5">
                {batch.map((item, index) => (
                  <div
                    key={item.id}
                    className={cn(
                      "sk-frame aspect-[3/4] rounded-[12px]",
                      index === 0 ? "ring-picked" : "shadow-[0_14px_24px_-16px_var(--shadow-2)]",
                    )}
                  >
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
                ))}
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                {["3:4", "4K", "质量高", "4 张"].map((chip) => (
                  <span
                    key={chip}
                    className="sk inline-flex h-[30px] items-center rounded-[9px] bg-tint/[0.055] px-3 text-[12.5px] font-semibold text-fg-soft tabular"
                  >
                    <span className="sk-in">{chip}</span>
                  </span>
                ))}
                <span className="sk ml-auto inline-flex h-10 items-center rounded-[12px] bg-acc px-5 font-display text-[17px] text-acc-ink shadow-acc">
                  <span className="sk-in gap-1">
                    生成<span className="numeral text-[21px]">4</span>张
                  </span>
                </span>
              </div>
            </div>
            <ModeLink href={signedIn ? "/studio" : "/login?next=%2Fstudio"}>打开生图</ModeLink>
          </article>

          <article className="glass relative flex flex-col overflow-hidden rounded-[20px] p-7 sm:p-9 lg:col-span-7">
            <Sticker>画布</Sticker>
            <h3 className="mt-5 font-display text-[clamp(30px,2.6vw,40px)] leading-tight font-normal text-fg">
              画布和{BRAND.agentName}
            </h3>
            <p className="mt-3 max-w-[36em] text-[15px] leading-relaxed text-fg-soft">
              在无限画布上和{BRAND.agentName}聊需求，它会先想好画面，再连续生成、排到画布上；也可以自己用节点连起来：一段描述接到生成，结果排在旁边。每轮最多 6 张。
            </p>
            <NodeBoard board={board} />
            <ModeLink href={signedIn ? "/projects" : "/login?next=%2Fprojects"}>打开画布</ModeLink>
          </article>
        </div>

        <div className="mt-24 grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <h3 className="font-display text-[clamp(30px,2.6vw,40px)] leading-tight font-normal text-fg">能用哪些模型</h3>
            <p className="mt-3 max-w-[26em] text-[15px] leading-relaxed text-fg-soft">
              实际能用哪些，以你的 Key 所在分组为准。画质分 1K、2K、4K，质量分自动、低、中、高，每个模型支持的档位不同。
            </p>
          </div>
          <ul className="divide-y divide-line border-y border-line lg:col-span-8">
            {KNOWN_IMAGE_MODELS.map((model) => (
              <li
                key={model.id}
                className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1 py-5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
              >
                <span className="text-[19px] leading-tight font-bold tracking-[-0.01em] text-fg">
                  {model.displayName}
                  <span className="ml-2.5 text-[13px] font-normal tracking-normal text-fg-muted">{model.maker}</span>
                </span>
                <span className="col-span-2 row-start-2 text-[14px] text-fg-soft sm:col-span-1 sm:row-start-auto">
                  {model.description}
                </span>
                <span className="col-start-2 row-start-1 flex justify-end gap-2 text-[12.5px] font-semibold text-fg-soft sm:col-start-auto sm:row-start-auto">
                  <span className="sk inline-flex h-7 items-center rounded-[8px] bg-tint/[0.055] px-2.5 tabular">
                    <span className="sk-in">最高 {model.resolutions.at(-1)}</span>
                  </span>
                  <span className="sk inline-flex h-7 items-center rounded-[8px] bg-tint/[0.055] px-2.5 tabular">
                    <span className="sk-in">
                      {model.qualities.length > 1 ? `质量 ${model.qualities.length} 档` : "质量自动"}
                    </span>
                  </span>
                  <span className="sk hidden h-7 items-center rounded-[8px] bg-tint/[0.055] px-2.5 tabular sm:inline-flex">
                    <span className="sk-in">
                      {model.maxInputImages > 0 ? `参考图 ${model.maxInputImages} 张` : "无参考图"}
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
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
      className="group mt-8 inline-flex w-fit items-center gap-1.5 rounded-md text-[15px] font-semibold text-fg underline decoration-line-strong underline-offset-[6px] transition-colors hover:decoration-acc"
    >
      {children}
      <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
    </Link>
  );
}

/**
 * A miniature node canvas: a prompt node wired to a generate node, wired to
 * three results, on a dotted board (a real canvas, so the dots are earned).
 */
function NodeBoard({ board }: { board: ShowcaseItem[] }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none relative mt-9 min-h-[320px] flex-1 overflow-hidden rounded-[16px] bg-tint/[0.03] bg-[radial-gradient(rgb(var(--tint)/0.14)_1px,transparent_1px)] [background-size:20px_20px] select-none"
    >
      <svg
        viewBox="0 0 700 320"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        fill="none"
        strokeWidth="2"
      >
        <path d="M206 102 C 250 102, 240 160, 286 160" stroke="var(--acc)" />
        <path d="M402 160 C 440 160, 436 73, 474 73" stroke="var(--line-strong)" />
        <path d="M402 160 C 480 160, 520 156, 586 156" stroke="var(--line-strong)" />
        <path d="M402 160 C 440 160, 436 246, 474 246" stroke="var(--line-strong)" />
      </svg>
      <div className="glass absolute top-[18%] left-[3%] w-[27%] rounded-[12px] p-3">
        <span className="poster-label text-[13px] text-fg">描述</span>
        <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-[1.55] text-fg-soft">{board[0]?.prompt}</p>
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
            alt={`${SAMPLE_ALT}：${item.prompt}`}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            style={{ objectPosition: item.focus }}
          />
        </figure>
      ))}
      <div className="glass-strong absolute right-[3%] bottom-[5%] max-w-[min(250px,44%)] rounded-[14px] rounded-br-[4px] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-fg">
        三张同一风格的海报，换成冷色调
      </div>
    </div>
  );
}

/** Where the three results sit on the board (fractions of 700×320). */
const BOARD_LAYOUT: React.CSSProperties[] = [
  { left: "68%", top: "4%" },
  { left: "84%", top: "30%" },
  { left: "68%", top: "58%" },
];
