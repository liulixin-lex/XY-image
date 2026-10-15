import { isIP } from "node:net";
import { Agent, fetch as httpFetch } from "undici";

import { findCause } from "../../utils/error-chain.js";
import { describeErrorForLog } from "../../utils/error-sanitizer.js";
import { ChatProviderError } from "../chat-providers/errors.js";
import {
  createSafeLookup,
  isPublicAddress,
} from "../chat-providers/network.js";
import { htmlToText } from "./html.js";

/**
 * read_webpage (第 68 条): the assistant opens a page it found (or one the
 * user pasted) and reads its text. The address comes from the model, so it
 * is treated like any user-supplied URL:
 * - http(s) on the default ports only, no user:password@, no single-label
 *   or .local/.internal hosts;
 * - every address the name resolves to must be public (the same DNS guard
 *   as personal chat providers, chat-providers/network.ts), checked on the
 *   connection itself, so a rebinding name cannot slip through;
 * - redirects are followed by hand (at most 5), each target checked again;
 * - at most 3 MB read, 20 s per request; HTML becomes plain text.
 */

export const READ_PAGE_CHARS = 6000;
const BODY_LIMIT = 3 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

/**
 * Why a page was not read. "blocked" (a private or local address) and
 * "format" (PDF, pictures) are final; "http" / "network" / "timeout" /
 * "empty" may still be read through a page-reading service (第 69 条,
 * agent/tools/web-search.ts).
 */
export type ReadPageFailure =
  | "blocked"
  | "format"
  | "http"
  | "network"
  | "timeout"
  | "empty"
  | "invalid";

export class ReadPageError extends Error {
  constructor(
    message: string,
    readonly kind: ReadPageFailure = "invalid",
  ) {
    super(message);
    this.name = "ReadPageError";
  }
}

export type ReadPageResult = {
  url: string;
  title: string;
  description: string;
  /** This slice of the page text. */
  text: string;
  offset: number;
  /** Where the next slice starts, or null when this was the end. */
  nextOffset: number | null;
  totalChars: number;
};

/** Throws ReadPageError (Chinese, shown to the model) for refused addresses. */
export function checkPageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ReadPageError("网址格式不对");
  }
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new ReadPageError("只能打开 http 或 https 网页");
  if (url.username || url.password)
    throw new ReadPageError("网址里不能带账号密码");
  if (url.port && !["80", "443"].includes(url.port))
    throw new ReadPageError("只能打开默认端口（80/443）的网页");
  if (
    !host ||
    (isIP(host)
      ? !isPublicAddress(host)
      : !host.includes(".") ||
        /(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|invalid|arpa)$/.test(
          host,
        ))
  )
    throw new ReadPageError("这个地址不能访问（内网或本机地址）", "blocked");
  return url;
}

const dispatcher = new Agent({
  connect: { lookup: createSafeLookup(), timeout: 8_000 },
  headersTimeout: TIMEOUT_MS,
  bodyTimeout: TIMEOUT_MS,
  connections: 4,
  maxOrigins: 200,
});

type PageFetch = (
  url: URL,
  signal: AbortSignal,
) => Promise<{
  status: number;
  headers: Headers;
  body: Buffer;
  location?: string;
}>;

const defaultPageFetch: PageFetch = async (url, signal) => {
  const res = await httpFetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
    },
    redirect: "manual",
    signal,
    dispatcher,
  });
  const location = res.headers.get("location") ?? undefined;
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > BODY_LIMIT) break; // read what fits
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  return {
    status: res.status,
    headers: res.headers as unknown as Headers,
    body: Buffer.concat(chunks),
    ...(location ? { location } : {}),
  };
};

function decode(body: Buffer, contentType: string): string {
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(
      body.subarray(0, 4096).toString("latin1"),
    )?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(declared.toLowerCase()).decode(body);
  } catch {
    return body.toString("utf8");
  }
}

/** A slice of a page's text, the way read_webpage hands it out. */
export function pageSlice(
  page: { url: string; title: string; description?: string; text: string },
  options: { offset?: number; maxChars?: number } = {},
): ReadPageResult {
  const maxChars = Math.max(
    500,
    Math.min(options.maxChars ?? READ_PAGE_CHARS, 20_000),
  );
  const offset = Math.max(0, Math.min(options.offset ?? 0, page.text.length));
  const end = Math.min(page.text.length, offset + maxChars);
  return {
    url: page.url,
    title: page.title,
    description: page.description ?? "",
    text: page.text.slice(offset, end),
    offset,
    nextOffset: end < page.text.length ? end : null,
    totalChars: page.text.length,
  };
}

export async function readWebPage(
  raw: string,
  options: {
    offset?: number;
    maxChars?: number;
    signal?: AbortSignal;
    fetch?: PageFetch;
  } = {},
): Promise<ReadPageResult> {
  const fetch = options.fetch ?? defaultPageFetch;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  let url = checkPageUrl(raw);
  let page: Awaited<ReturnType<PageFetch>> | undefined;
  for (let hop = 0; ; hop++) {
    try {
      page = await fetch(url, signal);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const blocked = findCause(
        error,
        (c): c is ChatProviderError =>
          c instanceof ChatProviderError &&
          c.code === "provider_blocked_address",
      );
      if (blocked)
        throw new ReadPageError(
          "这个地址不能访问（内网或本机地址）",
          "blocked",
        );
      console.warn(
        `[web-read] ${url.host} failed: ${describeErrorForLog(error)}`,
      );
      throw new ReadPageError(
        timeout.aborted ? "网页打开超时" : "网页打不开（连接失败）",
        timeout.aborted ? "timeout" : "network",
      );
    }
    if (page.status >= 300 && page.status < 400 && page.location) {
      if (hop >= MAX_REDIRECTS)
        throw new ReadPageError("网页跳转次数太多", "http");
      url = checkPageUrl(new URL(page.location, url).href);
      continue;
    }
    break;
  }
  if (page.status >= 400)
    throw new ReadPageError(
      `网页返回 HTTP ${page.status}，没有读到内容`,
      "http",
    );
  const type = (page.headers.get("content-type") ?? "").toLowerCase();
  if (/^(image|video|audio)\//.test(type))
    throw new ReadPageError("这是图片或音视频文件，读不了文字", "format");
  if (type.includes("pdf"))
    throw new ReadPageError("这是 PDF 文件，暂时读不了", "format");
  const decoded = decode(page.body, type);
  const isHtml =
    type.includes("html") ||
    (!type && /<html|<body|<!doctype/i.test(decoded.slice(0, 2000)));
  const { title, description, text } = isHtml
    ? htmlToText(decoded)
    : {
        title: "",
        description: "",
        text: decoded.replace(/\r\n/g, "\n").trim(),
      };
  const maxChars = Math.max(
    500,
    Math.min(options.maxChars ?? READ_PAGE_CHARS, 20_000),
  );
  const offset = Math.max(0, Math.min(options.offset ?? 0, text.length));
  const end = Math.min(text.length, offset + maxChars);
  console.info(
    `[web-read] ${url.host} ${page.status} ${type.split(";")[0] || "unknown"} ${page.body.length}B → ${text.length} chars (from ${offset})`,
  );
  return {
    url: url.href,
    title,
    description,
    text: text.slice(offset, end),
    offset,
    nextOffset: end < text.length ? end : null,
    totalChars: text.length,
  };
}
