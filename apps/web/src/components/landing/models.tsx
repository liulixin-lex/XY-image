import { MessagesSquareIcon, SparklesIcon } from "lucide-react";

import { BRAND } from "@/lib/brand";
import { KNOWN_IMAGE_MODELS, QUALITY_LABEL } from "@/lib/image-model-meta";

import { SAMPLE_ALT, type ShowcaseItem } from "./showcase";

/**
 * The two ways to work (a prompt in the 生图 page, or the canvas with the
 * assistant) and the list of models the main site can route to.
 */
export function ModesSection({ samples }: { samples: ShowcaseItem[] }) {
  const [direct, ...board] = samples;
  return (
    <section id="models" aria-labelledby="models-title" className="relative z-10 scroll-mt-6 py-24 lg:py-32">
      <div className="mx-auto max-w-[1600px] px-5 sm:px-8 lg:px-[clamp(24px,4.4vw,96px)]">
        <h2 id="models-title" className="font-display text-[clamp(40px,4.6vw,68px)] leading-[1.02] text-fg">
          两种用法
        </h2>

        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-12">
          <article className="glass relative flex flex-col overflow-hidden rounded-[22px] p-7 sm:p-9 lg:col-span-5">
            <span className="flex size-10 items-center justify-center rounded-full border border-line-strong bg-white/[0.04] text-amb">
              <SparklesIcon className="size-[18px]" strokeWidth={1.75} />
            </span>
            <h3 className="mt-6 text-[24px] font-semibold text-fg">直接生成</h3>
            <p className="mt-3 max-w-[30em] text-[15px] leading-relaxed text-fg-soft">
              写一句描述，选模型、比例和画质，点「开始生成」。可以带参考图，最多同时生成两张，结果按天归档。
            </p>
            {direct ? (
              <div className="relative mt-9 flex-1">
                <div className="relative ml-auto aspect-[4/3] w-[86%] overflow-hidden rounded-[16px] shadow-lit">
                  {/* biome-ignore lint/performance/noImgElement: static export */}
                  <img
                    src={direct.src}
                    alt={`${SAMPLE_ALT}：${direct.prompt}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                    style={{ objectPosition: direct.focus }}
                  />
                </div>
                <div className="glass-strong absolute bottom-6 left-0 w-[min(78%,300px)] rounded-[14px] px-4 py-3.5">
                  <p className="line-clamp-2 text-[13px] leading-relaxed text-fg">{direct.prompt}</p>
                  <p className="mt-2 flex gap-3 text-[12px] text-fg-muted">
                    <span>GPT Image 2</span>
                    <span className="tabular">2K · {direct.ratio}</span>
                  </p>
                </div>
              </div>
            ) : null}
          </article>

          <article className="glass relative flex flex-col overflow-hidden rounded-[22px] p-7 sm:p-9 lg:col-span-7">
            <span className="flex size-10 items-center justify-center rounded-full border border-line-strong bg-white/[0.04] text-amb">
              <MessagesSquareIcon className="size-[18px]" strokeWidth={1.75} />
            </span>
            <h3 className="mt-6 text-[24px] font-semibold text-fg">画布 + {BRAND.agentName}</h3>
            <p className="mt-3 max-w-[34em] text-[15px] leading-relaxed text-fg-soft">
              在无限画布上和{BRAND.agentName}聊需求，它会先想好画面，再连续生成、排到画布上。每轮最多 6 张，每张单独计费。
            </p>
            <div className="relative mt-9 min-h-[300px] flex-1 rounded-[16px] border border-line bg-[radial-gradient(rgb(255_255_255/0.07)_1px,transparent_1px)] [background-size:22px_22px]">
              {board.slice(0, 3).map((item, index) => (
                <figure
                  key={item.id}
                  className="absolute m-0 overflow-hidden rounded-[12px] shadow-[0_0_0_1px_rgb(255_255_255/0.12),0_30px_60px_-30px_rgb(2_4_10/0.9)]"
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
              <div className="glass-strong absolute right-4 bottom-4 max-w-[min(260px,70%)] rounded-[14px] rounded-br-[4px] px-4 py-3 text-[13px] leading-relaxed text-fg">
                三张同一风格的海报，换成冷色调
              </div>
            </div>
          </article>
        </div>

        <div className="mt-24 grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <h3 className="text-[24px] font-semibold text-fg">能用哪些模型</h3>
            <p className="mt-3 max-w-[26em] text-[15px] leading-relaxed text-fg-soft">
              实际能用哪些，以你的 Key 所在分组为准。画质只有 1K 和 2K 两档。
            </p>
          </div>
          <ul className="divide-y divide-line border-y border-line lg:col-span-8">
            {KNOWN_IMAGE_MODELS.map((model) => (
              <li
                key={model.id}
                className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1 py-5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_11.5rem]"
              >
                <span className="text-[17px] font-semibold text-fg">
                  {model.displayName}
                  <span className="ml-2.5 text-[13px] font-normal text-fg-muted">{model.maker}</span>
                </span>
                <span className="col-span-2 row-start-2 text-[14px] text-fg-soft sm:col-span-1 sm:row-start-auto">
                  {model.description}
                </span>
                <span className="col-start-2 row-start-1 flex justify-end gap-2 text-[12.5px] text-fg-soft sm:col-start-auto sm:row-start-auto">
                  <span className="rounded-full border border-line px-2.5 py-0.5 tabular">
                    最高 {QUALITY_LABEL[model.maxQuality]}
                  </span>
                  <span className="hidden rounded-full border border-line px-2.5 py-0.5 tabular sm:inline">
                    {model.maxInputImages > 0 ? `参考图 ${model.maxInputImages} 张` : "无参考图"}
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

/** Where the three canvas samples sit on the dotted board. */
const BOARD_LAYOUT: React.CSSProperties[] = [
  { left: "5%", top: "12%", width: "30%", aspectRatio: "3 / 4", rotate: "-3deg" },
  { left: "37%", top: "6%", width: "26%", aspectRatio: "3 / 4", rotate: "1.5deg" },
  { left: "62%", top: "20%", width: "24%", aspectRatio: "3 / 4", rotate: "4deg" },
];
