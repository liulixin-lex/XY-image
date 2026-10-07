import { BillingGuardError } from "../features/xy2api/errors.js";

// Provider errors may contain credentials or response bodies. Never log them.
export function sanitizeErrorForClient(error: unknown): string {
  return error instanceof BillingGuardError
    ? error.message
    : "请求处理失败，请稍后再试";
}
