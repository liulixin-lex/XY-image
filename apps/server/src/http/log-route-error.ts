import type { FastifyRequest } from "fastify";
import { ZodError } from "zod";

/**
 * Logs a failed request at error only when it is the server's fault. A 4xx
 * outcome is expected traffic, e.g. a save or thumbnail for a project just
 * deleted in another tab, a session that is gone, or invalid input. It is
 * logged at warn with its status and reason and no stack, so error-level
 * lines (and alerts built on them) stay meaningful.
 */
export function logRouteError(
  request: Pick<FastifyRequest, "log">,
  error: unknown,
  fields: Record<string, unknown>,
  message: string,
) {
  const status = clientErrorStatus(error);
  if (status === undefined) {
    request.log.error({ ...fields, err: error }, message);
    return;
  }
  request.log.warn(
    {
      ...fields,
      status,
      ...(error instanceof ZodError
        ? { reason: "invalid request" }
        : { reason: error instanceof Error ? error.message : String(error) }),
    },
    message,
  );
}

function clientErrorStatus(error: unknown): number | undefined {
  if (error instanceof ZodError) return 400;
  const status =
    typeof error === "object" && error !== null && "statusCode" in error
      ? error.statusCode
      : undefined;
  return typeof status === "number" && status >= 400 && status < 500
    ? status
    : undefined;
}
