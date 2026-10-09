import { BillingGuardError } from "../features/xy2api/errors.js";

// Provider errors may contain credentials or response bodies. Never log them.
export function sanitizeErrorForClient(error: unknown): string {
  return error instanceof BillingGuardError
    ? error.message
    : "请求处理失败，请稍后再试";
}

/**
 * One-line, credential-free description for operator logs (startup and fatal
 * paths). Config errors name the variable but never its value; driver errors
 * can echo connection strings, so URLs lose their userinfo and anything that
 * looks like a token or key is masked.
 */
export function describeErrorForLog(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1***@")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "***")
    .replace(/\bsk-[\w-]{6,}/gi, "sk-***")
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, "***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return `${name}: ${message}`;
}
