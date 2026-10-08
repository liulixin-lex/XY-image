/**
 * Pure form logic for adding / editing a chat provider: client-side checks,
 * request bodies, and how server error codes map back onto the form.
 *
 * The server stays the authority. The client only checks syntax (https,
 * lengths, model list); private / local address blocking (SSRF) is decided
 * on the server and comes back as `provider_blocked_address`.
 */
import {
  CHAT_PROVIDER_LIMITS,
  type ChatProvider,
  type ChatProviderCreate,
  type ChatProviderPatch,
} from "./chat-providers-api";

export type ModelsMode = "auto" | "manual";

export type ProviderFormValues = {
  name: string;
  baseUrl: string;
  /** Empty when editing = keep the saved key. */
  apiKey: string;
  modelsMode: ModelsMode;
  /** One model per line (commas also accepted). */
  modelsText: string;
};

export type ProviderField = "name" | "baseUrl" | "apiKey" | "models";
export type FieldErrors = Partial<Record<ProviderField, string>>;

const L = CHAT_PROVIDER_LIMITS;
const length = (value: string) => [...value].length;

export function initialFormValues(provider?: ChatProvider | null): ProviderFormValues {
  return {
    name: provider?.name ?? "",
    baseUrl: provider?.baseUrl ?? "",
    apiKey: "",
    modelsMode: provider?.modelsSource === "manual" ? "manual" : "auto",
    modelsText: provider?.modelsSource === "manual" ? provider.models.join("\n") : "",
  };
}

/**
 * https only; no credentials, query or fragment; no trailing slash. The
 * server appends `/models` and `/chat/completions`, so a query string would
 * land in the middle of every request URL.
 */
export function normalizeBaseUrl(input: string): { url: string } | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "填写接口地址" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "地址格式不对，应以 https:// 开头" };
  }
  if (url.protocol !== "https:") return { error: "只支持 https 地址" };
  if (url.username || url.password) return { error: "地址里不要带用户名或密码" };
  if (url.search) return { error: "地址里不要带 ? 后面的参数" };
  if (url.hash) return { error: "地址里不要带 # 后面的部分" };
  const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  if (length(normalized) > L.baseUrlLength) return { error: `地址最长 ${L.baseUrlLength} 个字符` };
  return { url: normalized };
}

export function parseModelList(text: string): { models: string[] } | { error: string } {
  const models = [
    ...new Set(
      text
        .split(/[\n,，]/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  if (models.length === 0) return { error: "至少填一个模型名" };
  if (models.length > L.models) return { error: `最多 ${L.models} 个模型` };
  const tooLong = models.find((model) => length(model) > L.modelNameLength);
  if (tooLong) return { error: `模型名最长 ${L.modelNameLength} 个字符` };
  return { models };
}

export type ValidatedForm = {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[] | null;
};

/**
 * Checks the form. When editing, a changed address needs the key again so
 * a saved key is never sent to a new host (plan §6.3).
 */
export function validateProviderForm(
  values: ProviderFormValues,
  original?: ChatProvider | null,
): { ok: true; value: ValidatedForm } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = "给服务商起个名字";
  else if (length(name) > L.nameLength) errors.name = `名称最长 ${L.nameLength} 个字`;

  const base = normalizeBaseUrl(values.baseUrl);
  if ("error" in base) errors.baseUrl = base.error;

  const apiKey = values.apiKey.trim();
  const addressChanged = Boolean(original) && "url" in base && base.url !== original?.baseUrl;
  if (!apiKey && (!original || addressChanged)) {
    errors.apiKey = original ? "改了接口地址，需要重新填写 API Key" : "填写 API Key";
  } else if (/\s/.test(apiKey)) {
    errors.apiKey = "API Key 里不应有空格或换行";
  }

  let models: string[] | null = null;
  if (values.modelsMode === "manual") {
    const parsed = parseModelList(values.modelsText);
    if ("error" in parsed) errors.models = parsed.error;
    else models = parsed.models;
  }

  if (Object.keys(errors).length > 0 || !("url" in base)) return { ok: false, errors };
  return { ok: true, value: { name, baseUrl: base.url, apiKey, models } };
}

export function buildCreateBody(form: ValidatedForm): ChatProviderCreate {
  return {
    name: form.name,
    protocol: "openai_compatible",
    baseUrl: form.baseUrl,
    apiKey: form.apiKey,
    ...(form.models ? { models: form.models } : {}),
  };
}

export type EditPlan = {
  /** null = nothing to PATCH. */
  patch: ChatProviderPatch | null;
  /** Switch a manual list back to auto with the same credentials. */
  refreshAfter: boolean;
};

/**
 * Only changed fields go out. With new credentials and `auto`, the server
 * re-reads the model list itself while verifying the key (same as create).
 */
export function buildEditPlan(original: ChatProvider, form: ValidatedForm): EditPlan {
  const patch: ChatProviderPatch = {};
  if (form.name !== original.name) patch.name = form.name;
  if (form.baseUrl !== original.baseUrl) patch.baseUrl = form.baseUrl;
  if (form.apiKey) patch.apiKey = form.apiKey;
  const credentialsChanged = patch.baseUrl !== undefined || patch.apiKey !== undefined;
  if (form.models) {
    const same =
      original.modelsSource === "manual" &&
      original.models.length === form.models.length &&
      original.models.every((model, i) => model === form.models?.[i]);
    if (!same || credentialsChanged) patch.models = form.models;
  }
  const refreshAfter = !form.models && original.modelsSource === "manual" && !credentialsChanged;
  return { patch: Object.keys(patch).length ? patch : null, refreshAfter };
}

/**
 * Where a server error belongs on the form. Codes not listed fall back to a
 * form-level message (the server's sanitised text, or a generic line).
 */
export function formErrorFor(
  code: string,
  serverMessage: string | null,
  context: { editingWithoutNewKey: boolean },
): { field?: ProviderField; message: string; switchToManual?: boolean } {
  switch (code) {
    case "provider_auth_failed":
      return context.editingWithoutNewKey
        ? { message: "服务商拒绝了已保存的 API Key，请重新填写" }
        : { field: "apiKey", message: "服务商拒绝了这个 API Key，检查是否填对、是否还有效" };
    case "provider_blocked_address":
      return { field: "baseUrl", message: "这个地址不能用：只支持 https 公网地址，不能是内网或本机" };
    case "provider_unreachable":
      return { field: "baseUrl", message: "连不上这个地址，检查是否填对" };
    case "provider_models_unavailable":
      return {
        field: "models",
        message: "这个服务商没有返回模型列表。改成手动填写，每行一个模型名",
        switchToManual: true,
      };
    case "provider_name_taken":
      return { field: "name", message: "已经有同名的服务商了，换个名字" };
    case "provider_limit_reached":
      return { message: `最多添加 ${L.providers} 个服务商，先删掉不用的` };
    case "provider_rate_limited":
      return { message: "服务商限制了请求频率，稍后再试" };
    case "provider_unavailable":
      return { message: "服务商暂时没有响应，稍后再试" };
    case "rate_limited":
      return { message: "操作太频繁，稍等一会再试" };
    case "network_error":
      return { message: "网络连接失败，请检查网络后再试" };
    case "provider_not_found":
      return { message: "这个服务商已经不在了，关掉弹窗后列表会刷新" };
    default:
      return { message: serverMessage || "保存没有成功，请稍后再试" };
  }
}

/** Short status for a provider row. */
export function providerStatusLabel(code: string | null): string | null {
  if (!code) return null;
  const labels: Record<string, string> = {
    provider_auth_failed: "Key 被拒绝",
    provider_blocked_address: "地址不可用",
    provider_unreachable: "连不上",
    provider_models_unavailable: "读不到模型",
    provider_rate_limited: "被限流",
    provider_unavailable: "无响应",
    provider_model_not_found: "模型不存在",
  };
  return labels[code] ?? "检查失败";
}
