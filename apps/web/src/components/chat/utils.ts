/**
 * Shared utility functions for chat components.
 *
 * Extracted to avoid duplication across chat sub-components
 * and to allow tree-shaking of unused helpers.
 */

import { getSupabaseBase } from "../../lib/env";

/** Regex patterns for detecting image URLs in markdown content */
const IMAGE_URL_RE = /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i;
/** Public, signed and transformed object paths of Supabase storage. */
const STORAGE_OBJECT_PATH_RE = /^\/storage\/v1\/(object|render\/image)\//;

/** An object URL on the configured Supabase storage (any domain or path, self-hosted included). */
function isOwnStorageUrl(url: string): boolean {
  const base = getSupabaseBase();
  if (!base) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === base.origin &&
      parsed.pathname.startsWith(`${base.path}/`) &&
      STORAGE_OBJECT_PATH_RE.test(parsed.pathname.slice(base.path.length))
    );
  } catch {
    return false;
  }
}

/**
 * Check if a URL points to an image resource.
 * Matches common image extensions and objects on our own Supabase storage.
 */
export function isImageUrl(url: string): boolean {
  return IMAGE_URL_RE.test(url) || isOwnStorageUrl(url);
}

/** Tool display configuration */
export type ToolDisplayConfig = {
  label: string;
  icon: string;
  showCard: boolean;
};

const TOOL_CONFIG: Record<string, ToolDisplayConfig> = {
  think: { label: "\u601d\u8003\u4e2d", icon: "tool", showCard: false },
  inspect_canvas: { label: "\u8bfb\u53d6\u753b\u5e03", icon: "eye", showCard: true },
  manipulate_canvas: { label: "\u64cd\u4f5c\u753b\u5e03", icon: "brush", showCard: true },
  generate_image: { label: "\u751f\u6210\u56fe\u7247", icon: "image", showCard: true },
  generate_video: { label: "\u751f\u6210\u89c6\u9891", icon: "video", showCard: true },
  screenshot_canvas: { label: "\u622a\u53d6\u753b\u5e03", icon: "eye", showCard: true },
  get_brand_kit: { label: "读取品牌套件", icon: "palette", showCard: true },
  project_search: { label: "\u641c\u7d22\u9879\u76ee", icon: "search", showCard: true },
  // 第 67 条: the model's built-in web search (run at the main site).
  web_search: { label: "联网搜索", icon: "search", showCard: true },
  // 第 67 条 审图 and file editing.
  view_images: { label: "查看图片", icon: "eye", showCard: true },
  apply_patch: { label: "修改资料", icon: "tool", showCard: false },
  task: { label: "\u6267\u884c\u4efb\u52a1", icon: "tool", showCard: false },
  // deepagents' built-in file tools: the assistant reading skill notes or
  // keeping scratch files. Raw file text means nothing to the user, so only
  // the status line shows.
  read_file: { label: "查阅资料", icon: "tool", showCard: false },
  ls: { label: "查看资料", icon: "tool", showCard: false },
  glob: { label: "查找资料", icon: "search", showCard: false },
  grep: { label: "搜索资料", icon: "search", showCard: false },
  write_file: { label: "记笔记", icon: "tool", showCard: false },
  edit_file: { label: "记笔记", icon: "tool", showCard: false },
  write_todos: { label: "规划步骤", icon: "tool", showCard: false },
};

export function getToolConfig(toolName: string): ToolDisplayConfig {
  return (
    TOOL_CONFIG[toolName] ?? {
      label: formatToolName(toolName),
      icon: "tool",
      showCard: true,
    }
  );
}

/** Convert raw tool name to human-readable: "generate_image" -> "Generate Image" */
export function formatToolName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Words that read as acronyms or brand marks rather than title case. */
const MODEL_WORDS: Record<string, string> = {
  gpt: "GPT",
  ai: "AI",
  hd: "HD",
  xl: "XL",
  sd: "SD",
  dall: "DALL",
  flux: "FLUX",
};

/**
 * Format a raw model ID for display: "gpt-image-2" -> "GPT Image 2",
 * "gemini-3-pro-image" -> "Gemini 3 Pro Image". Prefer catalog names when
 * the caller has them.
 */
export function formatModelDisplayName(model: string): string {
  const slug = model.split("/").pop() ?? model;
  if (/^dall-e/i.test(slug)) return slug.replace(/^dall-e-?/i, "DALL·E ").trim();
  return slug
    .split("-")
    .map((w) => MODEL_WORDS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Plain-language labels for the parameters our tools actually send. */
const PARAM_LABELS: Record<string, string> = {
  prompt: "提示词",
  model: "模型",
  aspectRatio: "比例",
  aspect_ratio: "比例",
  resolution: "画质",
  quality: "质量",
  size: "尺寸",
  n: "数量",
  title: "标题",
  name: "名称",
  query: "关键词",
  elements: "元素",
  error: "原因",
  width: "宽",
  height: "高",
};

/** Convert camelCase/snake_case param name to readable lowercase */
export function formatParamName(name: string): string {
  const label = PARAM_LABELS[name];
  if (label) return label;
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
}

/** Format a parameter value for display, truncating long strings */
export function formatParamValue(value: unknown): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "string")
    return value.length > 200 ? `${value.slice(0, 197)}...` : value;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value))
    return value.length === 0 ? "无" : JSON.stringify(value);
  return JSON.stringify(value);
}

/** Check if text looks like a human-readable string (not JSON) */
export function isHumanReadable(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return false;
  // Tool summaries in English are written for the model ("Canvas screenshot
  // captured (793x1024, mode: full)"); they stay in 查看详情.
  return /[\u4e00-\u9fff]/.test(trimmed);
}

/**
 * The card line for a finished canvas or search tool, in plain Chinese, read
 * from the tool's output (counts and sizes). Null when the output does not
 * say; the card then shows the tool's label.
 */
export function describeToolResult(
  toolName: string,
  output: Record<string, unknown> | undefined,
): string | null {
  if (!output) return null;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const failed = typeof output.error === "string";
  switch (toolName) {
    case "inspect_canvas": {
      const total = count(output.elementCount);
      if (total === null) return null;
      if (total === 0) return "画布还是空的";
      const matched = count(output.matchedCount);
      return matched !== null && matched !== total
        ? `画布上有 ${total} 个元素，符合条件的 ${matched} 个`
        : `画布上有 ${total} 个元素`;
    }
    case "screenshot_canvas": {
      if (failed) return "没有截到画布";
      const width = count(output.width);
      const height = count(output.height);
      return width && height ? `截取了画布（${width}×${height}）` : "截取了画布";
    }
    case "manipulate_canvas": {
      if (failed) return "画布改动没有保存上";
      const applied = count(output.applied) ?? 0;
      const errors = Array.isArray(output.errors) ? output.errors.length : 0;
      if (!applied && errors) return `${errors} 处改动没有成功`;
      return errors ? `改了 ${applied} 处，${errors} 处没有成功` : `改了 ${applied} 处`;
    }
    case "view_images": {
      const shown = count(output.shown);
      if (shown === null) return null;
      return shown === 0 ? "没有找到这些图片" : `看了 ${shown} 张图`;
    }
    case "web_search": {
      const sources = Array.isArray(output.sources) ? output.sources.length : 0;
      const what =
        output.action === "open_page"
          ? "打开了一个网页"
          : output.action === "find_in_page"
            ? `在网页里查找${typeof output.pattern === "string" ? `「${output.pattern}」` : ""}`
            : `搜索${typeof output.query === "string" ? `「${output.query}」` : "了网页"}`;
      return sources ? `${what}，看了 ${sources} 个来源` : what;
    }
    case "project_search": {
      const matches = count(output.matchCount);
      if (matches === null) return null;
      return matches === 0 ? "没有找到相关资料" : `找到 ${matches} 处相关资料`;
    }
    default:
      return null;
  }
}

/** Format first 3 entries of tool output as preview lines */
export function formatOutputPreview(
  output: Record<string, unknown>,
): string[] {
  const entries = Object.entries(output).slice(0, 3);
  return entries.map(([key, value]) => {
    const formattedKey = formatParamName(key);
    let formattedValue: string;
    if (value === null || value === undefined) {
      formattedValue = "\u2014";
    } else if (typeof value === "string") {
      formattedValue =
        value.length > 80 ? `${value.slice(0, 77)}...` : value;
    } else if (typeof value === "boolean") {
      formattedValue = value ? "是" : "否";
    } else if (typeof value === "number") {
      formattedValue = String(value);
    } else if (Array.isArray(value)) {
      formattedValue = `${value.length} 项`;
    } else {
      formattedValue = "{...}";
    }
    return `${formattedKey}: ${formattedValue}`;
  });
}
