import type { StructuredTool } from "@langchain/core/tools";
import { tool } from "langchain";
import { z } from "zod";

import {
  type GroundedSearch,
  geminiGroundedSearch,
} from "../../features/web-search/gemini-grounded.js";
import {
  ReadPageError,
  readWebPage,
} from "../../features/web-search/read-page.js";
import { READ_PAGE_CHARS } from "../../features/web-search/read-page.js";
import type { WebSearchService } from "../../features/web-search/service.js";
import { describeErrorForLog } from "../../utils/error-sanitizer.js";

/**
 * search_web and read_webpage (第 68 条): 联网搜索 for chat models whose
 * built-in search the main site cannot run inside the answer (Gemini next
 * to function tools, personal providers, other vendors). The model calls
 * them like any tool; agent/model-options.ts shows them only while 联网搜索
 * is on, and switches to them when a model refuses its built-in search.
 *
 * - mode "gemini": the query goes to Gemini's own Google Search in a
 *   separate call (features/web-search/gemini-grounded.ts); if that fails
 *   or does not ground, the free search below answers instead.
 * - mode "free": the free search (features/web-search/service.ts).
 *
 * Both return JSON the model reads and the chat shows as a 联网搜索 block
 * (stream-adapter.ts webToolDisplay keeps only the query and sources). A
 * search that finds nothing returns that as a result, not an error, with a
 * note not to make things up.
 */

export const SEARCH_WEB_TOOL = "search_web";
export const READ_WEBPAGE_TOOL = "read_webpage";
export const WEB_TOOL_NAMES: ReadonlySet<string> = new Set([
  SEARCH_WEB_TOOL,
  READ_WEBPAGE_TOOL,
]);
/** Per run; past it the model is told to answer from what it has. */
export const RUN_SEARCH_LIMIT = 12;
export const RUN_READ_LIMIT = 12;

export type WebToolsOptions = {
  mode: "gemini" | "free";
  service: WebSearchService;
  /** The chat key and model (mode "gemini"). */
  gemini?: { baseUrl: string; apiKey: string; model: string };
  geminiSearch?: typeof geminiGroundedSearch;
  readPage?: typeof readWebPage;
};

const searchSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "What to search for: a few keywords or a short question, in the language the sources are likely written in.",
    ),
  count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("How many results (default 6)."),
});

const readSchema = z.object({
  url: z
    .string()
    .min(1)
    .max(2000)
    .describe("The page address (http or https)."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Where to continue reading: the next_offset of the previous call.",
    ),
});

const SEARCH_DESCRIPTION =
  "Search the web for current or outside information: trends, dates of holidays and events, facts about a brand, product or place, what others did. Returns results with title, url and snippet (or a sourced answer). Search only when the answer depends on facts you may not know or that may have changed; not for purely creative work. One search per question is usually enough: search again only with a clearly different query when the first gave nothing useful. Then use read_webpage on the one or two most useful results when the snippets are not enough. Cite the sources (title and link) in your reply. If nothing is found, say so; never make up sources.";

const READ_DESCRIPTION = `Open a web page and read its text (title, description, body), ${READ_PAGE_CHARS} characters at a time; call again with next_offset for more. Use it on a search result or a link the user gave. Public http(s) pages only.`;

function json(value: unknown) {
  return JSON.stringify(value);
}

export function createWebTools(options: WebToolsOptions): StructuredTool[] {
  const geminiSearch = options.geminiSearch ?? geminiGroundedSearch;
  const readPage = options.readPage ?? readWebPage;
  let searches = 0;
  let reads = 0;

  const searchWeb = tool(
    async (input, config) => {
      const signal = (config as { signal?: AbortSignal } | undefined)?.signal;
      const query = input.query.trim();
      if (++searches > RUN_SEARCH_LIMIT)
        return json({
          summary: "这一轮搜索次数已用完",
          query,
          results: [],
          note: `这一轮已经搜了 ${RUN_SEARCH_LIMIT} 次。不要再搜，用已有的结果回答，并说明哪些没查到。`,
        });
      let grounded: GroundedSearch | undefined;
      if (options.mode === "gemini" && options.gemini) {
        try {
          grounded = await geminiSearch({
            ...options.gemini,
            query,
            ...(signal ? { signal } : {}),
          });
          if (grounded.grounded)
            return json({
              summary: `搜索「${query.slice(0, 40)}」，看了 ${grounded.sources.length} 个来源`,
              query,
              via: "gemini",
              answer: grounded.answer,
              searches: grounded.queries,
              sources: grounded.sources,
              note: "这是用 Google 搜索后按来源整理的回答，可以直接引用这些来源；同一个问题不用再搜。",
            });
        } catch (error) {
          if (signal?.aborted) throw error;
          console.warn(
            `[web-search] gemini grounded search failed (${describeErrorForLog(error)}); using the free search`,
          );
        }
      }
      const outcome = await options.service.search(query, {
        count: input.count ?? 6,
        ...(signal ? { signal } : {}),
      });
      if (!outcome.results.length && grounded?.answer)
        // Nothing found anywhere; Gemini's own answer is still something.
        return json({
          summary: `搜索「${query.slice(0, 40)}」没有找到网页来源`,
          query,
          via: "gemini",
          answer: grounded.answer,
          sources: [],
          note: "这个回答没有网页来源，可能过时。告诉用户这是未经核实的信息。",
        });
      if (!outcome.results.length)
        return json({
          summary: `搜索「${query.slice(0, 40)}」没有结果`,
          query,
          results: [],
          note: "这次没有搜到（搜索服务可能暂时不可用）。可以换个关键词再搜一次；仍然没有就告诉用户这次没能联网查到，不要编造。",
        });
      return json({
        summary: `搜索「${query.slice(0, 40)}」，找到 ${outcome.results.length} 条`,
        query,
        via: outcome.provider,
        results: outcome.results,
      });
    },
    {
      name: SEARCH_WEB_TOOL,
      description: SEARCH_DESCRIPTION,
      schema: searchSchema,
    },
  );

  const readWebpage = tool(
    async (input, config) => {
      const signal = (config as { signal?: AbortSignal } | undefined)?.signal;
      if (++reads > RUN_READ_LIMIT)
        return json({
          summary: "这一轮读网页的次数已用完",
          url: input.url,
          error: `这一轮已经读了 ${RUN_READ_LIMIT} 个网页。用已有的内容回答。`,
        });
      try {
        const page = await readPage(input.url, {
          ...(input.offset !== undefined ? { offset: input.offset } : {}),
          ...(signal ? { signal } : {}),
        });
        let host = "";
        try {
          host = new URL(page.url).host;
        } catch {
          // keep empty
        }
        return json({
          summary: `读了 ${host || "网页"}${page.offset ? `（从第 ${page.offset} 字起）` : ""}`,
          url: page.url,
          title: page.title,
          ...(page.description ? { description: page.description } : {}),
          text:
            page.text ||
            "（这个网页没有可读的文字，可能要在浏览器里运行脚本才显示）",
          ...(page.nextOffset !== null
            ? { next_offset: page.nextOffset, total_chars: page.totalChars }
            : {}),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        const why =
          error instanceof ReadPageError ? error.message : "网页打不开";
        if (!(error instanceof ReadPageError))
          console.warn(`[web-read] failed: ${describeErrorForLog(error)}`);
        return json({
          summary: `没有读到这个网页：${why}`,
          url: input.url,
          error: why,
        });
      }
    },
    {
      name: READ_WEBPAGE_TOOL,
      description: READ_DESCRIPTION,
      schema: readSchema,
    },
  );

  return [searchWeb, readWebpage] as unknown as StructuredTool[];
}
