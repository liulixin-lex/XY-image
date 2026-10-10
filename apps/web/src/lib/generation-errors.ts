/**
 * One catalog for every generation / billing error code the API can return
 * (HTTP `error.code`, WebSocket `billing.error.code`, job `error_code`).
 *
 * Product rules encoded here (PRODUCT.md principles 1 and 2):
 * - Never imply "not charged" when the server says the state is unknown.
 * - Never offer an automatic retry for a generation that may have reached
 *   the main site; only the user decides to submit again.
 */
import { ApiApplicationError, ApiAuthError } from "./server-api";

/** What the primary button of an issue should do. */
export type IssueAction =
  | "recharge" // open main-site recharge page
  | "keys" // go to /settings?tab=keys (select or sync a key)
  | "main_keys" // open main-site key management (IP whitelist, quota)
  | "usage" // open main-site usage page to reconcile
  | "relogin" // local sign-out, back to /login
  | "reload_models" // re-read the model list for the current key
  | "providers" // go to /settings?tab=models (the user's own chat providers)
  | "none";

/** How loudly to surface the issue. */
export type IssueWeight = "dialog" | "toast";

export type IssueSpec = {
  title: string;
  message: string;
  action: IssueAction;
  weight: IssueWeight;
  /** True when the main site may already have charged for this attempt. */
  maybeCharged: boolean;
};

const CATALOG: Record<string, IssueSpec> = {
  insufficient_balance: {
    title: "主站余额不足",
    message: "这次没有发出生成请求，不收费。充值后回到这里重新提交。",
    action: "recharge",
    weight: "dialog",
    maybeCharged: false,
  },
  key_unavailable: {
    title: "当前 Key 不可用",
    message: "所选 Key 可能已停用、过期或不支持生图。同步 Key 列表，或换一个可用的 Key。",
    action: "keys",
    weight: "dialog",
    maybeCharged: false,
  },
  key_quota_exhausted: {
    title: "Key 额度已用完",
    message: "这个 Key 在主站设置的额度已经用完。换一个 Key，或到主站调高额度。",
    action: "keys",
    weight: "dialog",
    maybeCharged: false,
  },
  key_ip_restricted: {
    title: "Key 限制了访问 IP",
    message: "这个 Key 设置了 IP 白名单，需要在主站放行生图站的出口 IP。",
    action: "main_keys",
    weight: "dialog",
    maybeCharged: false,
  },
  xy2api_reauth_required: {
    title: "登录已过期",
    message: "主站登录状态已失效，请重新登录。",
    action: "relogin",
    weight: "dialog",
    maybeCharged: false,
  },
  model_not_accessible: {
    title: "当前 Key 不能用这个模型",
    message: "模型列表已经变化，请从最新列表里重新选择模型。",
    action: "reload_models",
    weight: "toast",
    maybeCharged: false,
  },
  concurrency_limit: {
    title: "同时最多生成 2 张",
    message: "等前面的任务完成后再提交。",
    action: "none",
    weight: "toast",
    maybeCharged: false,
  },
  run_image_limit: {
    title: "本轮生图次数已达上限",
    message: "每轮对话最多生成 6 张图。开启新一轮对话后可以继续。",
    action: "none",
    weight: "toast",
    maybeCharged: false,
  },
  rate_limited: {
    title: "请求太频繁",
    message: "稍等片刻，再手动提交一次。",
    action: "none",
    weight: "toast",
    maybeCharged: false,
  },
  upstream_busy: {
    title: "主站暂时繁忙",
    message: "这次请求没有成功。稍后手动再试一次。",
    action: "none",
    weight: "toast",
    maybeCharged: false,
  },
  invalid_input: {
    title: "参数无法生成",
    message: "检查提示词、比例、画质和参考图张数是否符合当前模型的要求。",
    action: "none",
    weight: "toast",
    maybeCharged: false,
  },
  safety_filter: {
    title: "内容未通过审核",
    message: "修改提示词或参考图后再试。",
    action: "none",
    weight: "toast",
    maybeCharged: false,
  },
  // The main site refused for a reason we cannot classify (new xy2api rule,
  // custom moderation wording, ...). Not charged; the Key is left alone.
  // describeIssue shows the server's message, which quotes the main site.
  request_rejected: {
    title: "主站拒绝了这次请求",
    message: "到主站查看账号和 Key 状态，或修改提示词后再试。",
    action: "none",
    weight: "toast",
    maybeCharged: false,
  },
  upstream_too_large: {
    title: "图片响应过大",
    message: "把画质降到 1K 后再提交。",
    action: "none",
    weight: "toast",
    maybeCharged: false,
  },
  upstream_unknown: {
    title: "请求中断，结果待核对",
    message: "图片可能已经生成。请先到主站用量页核对，确认后再决定是否重新提交。",
    action: "usage",
    weight: "dialog",
    maybeCharged: true,
  },
  storage_failed: {
    title: "图片已生成，但保存失败",
    message: "请联系管理员，并到主站用量页核对这一笔。",
    action: "usage",
    weight: "dialog",
    maybeCharged: true,
  },
  // Charged, and the server still holds the image: storage refused it and
  // the upload is retried for about an hour (server M6). Nothing to reconcile
  // and nothing to resubmit, so not maybeCharged.
  storage_retrying: {
    title: "图片已生成，正在保存",
    message: "这张已经生成。保存成功后会出现在生成记录里，不用重新提交。",
    action: "none",
    weight: "toast",
    maybeCharged: false,
  },
  xy2api_unavailable: {
    title: "主站暂时不可用",
    message: "暂时连不上主站，请稍后再试。",
    action: "none",
    weight: "toast",
    maybeCharged: false,
  },

  // The user's own chat providers (plan §6.5). They never touch the main-site
  // balance, so maybeCharged stays false; whatever the provider bills is
  // between the user and that provider, and the copy makes no claim about it.
  // Settings problems open a dialog that leads to the provider settings;
  // passing ones are toasts.
  provider_auth_failed: {
    title: "服务商拒绝了 API Key",
    message: "这次对话没有完成。到设置里重新填写这个服务商的 API Key，或换回主站模型。",
    action: "providers",
    weight: "dialog",
    maybeCharged: false,
  },
  provider_model_not_found: {
    title: "服务商找不到这个模型",
    message: "模型可能已下线或改名。到设置里刷新这个服务商的模型列表，再重新选择。",
    action: "providers",
    weight: "dialog",
    maybeCharged: false,
  },
  provider_tools_unsupported: {
    title: "这个模型不支持工具调用",
    message: "设计助手要用工具来读画布和生图。换一个支持工具调用的模型再试。",
    action: "none",
    weight: "dialog",
    maybeCharged: false,
  },
  provider_unreachable: {
    title: "连不上服务商",
    message: "检查这个服务商的接口地址是否填对，或稍后再试。",
    action: "providers",
    weight: "dialog",
    maybeCharged: false,
  },
  provider_blocked_address: {
    title: "这个接口地址不能用",
    message: "只支持 https 的公网地址，不能是内网或本机地址。到设置里改一下接口地址。",
    action: "providers",
    weight: "dialog",
    maybeCharged: false,
  },
  provider_models_unavailable: {
    title: "读不到服务商的模型列表",
    message: "到设置里把这个服务商改成手动填写模型名。",
    action: "providers",
    weight: "dialog",
    maybeCharged: false,
  },
  provider_rate_limited: {
    title: "服务商限制了请求频率",
    message: "稍等片刻再发送，或换一个模型。",
    action: "none",
    weight: "toast",
    maybeCharged: false,
  },
  provider_unavailable: {
    title: "服务商暂时没有响应",
    message: "这次对话没有完成。稍后再发送一次，或换一个模型。",
    action: "none",
    weight: "toast",
    maybeCharged: false,
  },
};

const FALLBACK: IssueSpec = {
  title: "生成失败",
  message: "这次请求没有完成，请稍后再试。",
  action: "none",
  weight: "toast",
  maybeCharged: false,
};

export function issueForCode(code: string | null | undefined): IssueSpec {
  return (code && CATALOG[code]) || FALLBACK;
}

export function isKnownIssueCode(code: string | null | undefined): boolean {
  return Boolean(code && CATALOG[code]);
}

/** Extract a stable code from anything thrown by the API clients. */
export function issueCodeOf(error: unknown): string {
  if (error instanceof ApiAuthError) return "xy2api_reauth_required";
  if (error instanceof ApiApplicationError) return error.code;
  return "application_error";
}

/**
 * Prefer the server's sanitized message for codes the catalog does not know
 * (and for request_rejected, whose message quotes the main site's reason),
 * otherwise use the catalog copy (consistent wording across HTTP/WS/jobs).
 */
export function describeIssue(
  code: string,
  serverMessage?: string | null,
): IssueSpec {
  if (code === "request_rejected" && serverMessage)
    return { ...issueForCode(code), message: serverMessage };
  if (isKnownIssueCode(code)) return issueForCode(code);
  return serverMessage ? { ...FALLBACK, message: serverMessage } : FALLBACK;
}
