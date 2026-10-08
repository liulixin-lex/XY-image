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
