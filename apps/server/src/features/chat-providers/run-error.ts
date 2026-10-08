import type { LoomicError } from "@loomic/shared";
import { sanitizeErrorForClient } from "../../utils/error-sanitizer.js";
import { ChatProviderError, findChatProviderError } from "./errors.js";

export function chatRunError(error: unknown, custom = false): LoomicError {
  const known =
    findChatProviderError(error) ??
    (custom ? new ChatProviderError("provider_unavailable") : undefined);
  // The route-only throttle code is not emitted by the model transport.
  if (known && known.code !== "rate_limited")
    return { code: known.code, message: known.message };
  return { code: "run_failed", message: sanitizeErrorForClient(error) };
}
