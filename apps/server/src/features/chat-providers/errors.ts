import {
  isContextOverflowText,
  markContextOverflow,
} from "../../utils/context-overflow.js";
import { causeChain, findCause } from "../../utils/error-chain.js";

const messages = {
  provider_auth_failed: "服务商 API Key 无效或没有权限，请检查设置",
  provider_model_not_found:
    "服务商说没有这个模型。换一个模型再试，或刷新模型列表",
  provider_rate_limited: "服务商请求过于频繁，请稍后再试",
  provider_tools_unsupported:
    "这个模型不支持设计助手所需的工具调用，请更换模型",
  provider_unavailable: "服务商暂时不可用，请稍后再试",
  provider_unreachable: "无法连接服务商，请检查接口地址",
  provider_blocked_address: "服务商地址不被允许，请使用 HTTPS 公网地址",
  provider_models_unavailable: "服务商没有提供可用的模型列表，请手动填写",
  provider_name_taken: "已经有同名服务商，请换一个名称",
  provider_limit_reached: "最多可以添加 10 个服务商",
  provider_not_found: "找不到这个服务商",
  invalid_request: "请求参数无效；修改接口地址时需要重新填写 API Key",
  rate_limited: "请求过于频繁，请稍后再试",
} as const;
export type ChatProviderErrorCode = keyof typeof messages;

export class ChatProviderError extends Error {
  modelsEndpointMissing = false;
  /** The provider's HTTP status, when it answered (mapProviderStatus). */
  upstreamStatus?: number;
  /**
   * What a 4xx said it could not take, as a fixed word: never the
   * provider's own text, which may echo the user's key (agent/
   * model-options.ts reads it to drop the option and call again).
   */
  refusedOption?: "web_search" | "effort" | "image";
  constructor(
    readonly code: ChatProviderErrorCode,
    readonly statusCode = 400,
  ) {
    super(messages[code]);
    this.name = "ChatProviderError";
  }
}
export function findChatProviderError(
  error: unknown,
): ChatProviderError | undefined {
  return findCause(
    error,
    (candidate): candidate is ChatProviderError =>
      candidate instanceof ChatProviderError,
  );
}
export function mapProviderStatus(status: number, body = "", models = false) {
  const code: ChatProviderErrorCode =
    status === 401 || status === 403
      ? "provider_auth_failed"
      : status === 404
        ? models
          ? "provider_models_unavailable"
          : "provider_model_not_found"
        : status === 429
          ? "provider_rate_limited"
          : status === 400 && /tools?|function.?call/i.test(body)
            ? "provider_tools_unsupported"
            : "provider_unavailable";
  const error = new ChatProviderError(code);
  error.modelsEndpointMissing = models && status === 404;
  error.upstreamStatus = status;
  // Too long for the model: deepagents' summarization catches a
  // ContextOverflowError anywhere in the cause chain and compacts.
  if ((status === 400 || status === 413 || status === 422) && isContextOverflowText(body))
    markContextOverflow(error);
  if (status >= 400 && status < 500) {
    if (/web[_ ]?search|hosted tool|tool type|unsupported tool|search tool/i.test(body))
      error.refusedOption = "web_search";
    else if (/image_url|image input|vision|multimodal|multi-modal/i.test(body))
      error.refusedOption = "image";
    else if (/reasoning|effort|thinking/i.test(body)) error.refusedOption = "effort";
  }
  return error;
}
export function mapProviderConnectionError(error: unknown): ChatProviderError {
  const known = findChatProviderError(error);
  if (known) return known;
  for (const current of causeChain(error)) {
    const code = "code" in current ? current.code : undefined;
    const name = "name" in current ? current.name : undefined;
    if (
      name === "TimeoutError" ||
      name === "AbortError" ||
      (typeof code === "string" && /TIMEOUT|TIMEDOUT/.test(code))
    )
      return new ChatProviderError("provider_unavailable");
  }
  return new ChatProviderError("provider_unreachable");
}
