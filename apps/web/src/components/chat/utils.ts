/**
 * Shared utility functions for chat components.
 *
 * Extracted to avoid duplication across chat sub-components
 * and to allow tree-shaking of unused helpers.
 */

/** Regex patterns for detecting image URLs in markdown content */
const IMAGE_URL_RE = /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i;
const SUPABASE_STORAGE_RE = /supabase\.\w+\/storage\/v1\//i;

/**
 * Check if a URL points to an image resource.
 * Matches common image extensions and Supabase storage URLs.
 */
export function isImageUrl(url: string): boolean {
  return IMAGE_URL_RE.test(url) || SUPABASE_STORAGE_RE.test(url);
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
  task: { label: "\u6267\u884c\u4efb\u52a1", icon: "tool", showCard: false },
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
  quality: "画质",
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
  return true;
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
