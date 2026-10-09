import type { LoomicError } from "@loomic/shared";
import {
  GENERIC_CLIENT_ERROR,
  sanitizeErrorForClient,
} from "../../utils/error-sanitizer.js";
import { BillingGuardError } from "../xy2api/errors.js";
import { ChatProviderError, findChatProviderError } from "./errors.js";

export function chatRunError(error: unknown, custom = false): LoomicError {
  const known =
    findChatProviderError(error) ??
    (custom ? new ChatProviderError("provider_unavailable") : undefined);
  // The route-only throttle code is not emitted by the model transport.
  if (known && known.code !== "rate_limited")
    return { code: known.code, message: known.message };
  // The main site refused the chat request (moderation, balance, Key, ...).
  // The chat transport (agent/deep-agent.ts) raises a GatewayError, which the
  // OpenAI client wraps as the cause of a connection error. Keep its code for
  // the page's issue center and its user-facing message. "upstream_unknown"
  // stays generic: its copy is about an image that may have been charged.
  const refusal = custom ? undefined : findBillingGuardError(error);
  if (refusal?.code === "upstream_unknown")
    return { code: "run_failed", message: GENERIC_CLIENT_ERROR };
  if (refusal)
    return {
      code: "run_failed",
      message: refusal.message,
      details: { gatewayCode: refusal.code },
    };
  return { code: "run_failed", message: sanitizeErrorForClient(error) };
}

function findBillingGuardError(error: unknown): BillingGuardError | undefined {
  let current = error;
  for (let i = 0; i < 8 && current && typeof current === "object"; i++) {
    if (current instanceof BillingGuardError) return current;
    current = "cause" in current ? current.cause : undefined;
  }
}
