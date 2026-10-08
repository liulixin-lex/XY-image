import { Agent, fetch as directFetch } from "undici";
import type { ServerEnv } from "../config/env.js";

// Backend traffic stays on the Docker network; SDK-generated Storage URLs remain public.
// Never send service-role credentials through the process-wide external proxy.
let dispatcher: Agent | undefined;
export function createSupabaseFetch(
  env: Pick<ServerEnv, "supabaseUrl" | "supabaseInternalUrl">,
  fetcher?: typeof fetch,
): typeof fetch {
  const publicBase = env.supabaseUrl?.replace(/\/$/, "");
  const internalBase = env.supabaseInternalUrl?.replace(/\/$/, "");
  if (!internalBase || !publicBase) return fetcher ?? fetch;
  return async (input, init) => {
    const original = input instanceof Request ? input : undefined;
    const url = new URL(original?.url ?? String(input));
    const base = new URL(publicBase);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(`${base.pathname.replace(/\/$/, "")}/`)
    ) {
      throw new Error("Unexpected Supabase request origin");
    }
    const basePath = base.pathname.replace(/\/$/, "");
    const target = `${internalBase}${url.pathname.slice(basePath.length)}${url.search}`;
    // Normalize Request inputs into URL/init so bundled undici and Node's native
    // Request classes do not need to share constructor identity.
    const request = original ? new Request(original, init) : undefined;
    const signal = request?.signal ?? init?.signal;
    const options: RequestInit & { duplex?: "half" } = {
      ...(request
        ? {
            method: request.method,
            headers: request.headers,
            body: request.body,
            ...(request.body ? { duplex: "half" as const } : {}),
          }
        : init),
      redirect: "error" as const,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    };
    if (fetcher) return fetcher(target, options);
    dispatcher ??= new Agent({ connections: 16, connect: { timeout: 10_000 } });
    return directFetch(target, { ...options, dispatcher } as Parameters<
      typeof directFetch
    >[1]) as unknown as Promise<Response>;
  };
}
export async function closeSupabaseTransport() {
  const current = dispatcher;
  dispatcher = undefined;
  await current?.close();
}
