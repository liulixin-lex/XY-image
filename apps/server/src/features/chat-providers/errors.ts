const messages = {
  provider_auth_failed: "服务商 API Key 无效或没有权限，请检查设置",
  provider_model_not_found: "服务商没有这个模型，请刷新模型列表后重新选择",
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
  let current = error;
  for (let i = 0; i < 8 && current && typeof current === "object"; i++) {
    if (current instanceof ChatProviderError) return current;
    current = "cause" in current ? current.cause : undefined;
  }
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
  return error;
}
export function mapProviderConnectionError(error: unknown): ChatProviderError {
  const known = findChatProviderError(error);
  if (known) return known;
  let current = error;
  for (let i = 0; i < 8 && current && typeof current === "object"; i++) {
    const code = "code" in current ? current.code : undefined;
    const name = "name" in current ? current.name : undefined;
    if (
      name === "TimeoutError" ||
      name === "AbortError" ||
      (typeof code === "string" && /TIMEOUT|TIMEDOUT/.test(code))
    )
      return new ChatProviderError("provider_unavailable");
    current = "cause" in current ? current.cause : undefined;
  }
  return new ChatProviderError("provider_unreachable");
}
