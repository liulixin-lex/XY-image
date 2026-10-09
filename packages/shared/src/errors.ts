import { z } from "zod";

export const errorCodeValues = [
  "invalid_request",
  "run_not_found",
  "run_conflict",
  "run_failed",
  "tool_failed",
  "provider_auth_failed",
  "provider_model_not_found",
  "provider_rate_limited",
  "provider_tools_unsupported",
  "provider_unavailable",
  "provider_unreachable",
  "provider_blocked_address",
  "provider_models_unavailable",
  "provider_name_taken",
  "provider_limit_reached",
  "provider_not_found",
] as const;

export const errorCodeSchema = z.enum(errorCodeValues);

export const loomicErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type LoomicErrorCode = z.infer<typeof errorCodeSchema>;
export type LoomicError = z.infer<typeof loomicErrorSchema>;

/**
 * The line a failed run leaves in the conversation, the same on the page
 * (apps/web use-chat-stream) and in the saved message (apps/server
 * ws/assistant-draft). A main-site refusal (`details.gatewayCode`: moderation,
 * balance, Key, ...) says what happened; anything else stays generic.
 */
export function runFailureText(
  error: Pick<LoomicError, "message" | "details">,
): string {
  return typeof error.details?.gatewayCode === "string"
    ? `没能完成：${error.message}`
    : "抱歉，处理过程中遇到问题，请重试。";
}

/** The line a run stopped before any reply leaves (page and saved message). */
export const RUN_STOPPED_TEXT = "已停止。";
