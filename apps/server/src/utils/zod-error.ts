import { ZodError } from "zod";

/**
 * True for a validation error from either zod copy in the repo: the server
 * uses zod 4, while @loomic/shared still builds its request schemas with
 * zod 3, whose ZodError is a different class. Checking only `instanceof`
 * turned bad input on shared schemas into a 503 "主站不可用".
 * TODO(agent01): drop the duck check once shared moves to zod 4.
 */
export function isZodError(error: unknown): boolean {
  if (error instanceof ZodError) return true;
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}
