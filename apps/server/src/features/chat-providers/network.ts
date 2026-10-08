import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, type LookupFunction, isIP } from "node:net";
import { Agent, fetch as httpFetch } from "undici";
import { readLimitedBody } from "../../utils/limited-body.js";
import {
  ChatProviderError,
  mapProviderConnectionError,
  mapProviderStatus,
} from "./errors.js";
import { hasControlCharacters } from "./validation.js";

export type ProviderNetworkPolicy = {
  allowHttp?: boolean;
  allowedHosts?: string[];
  forbiddenUrls?: string[];
};
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");

function hostname(value: string) {
  return value
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
}
export function isPublicAddress(value: string): boolean {
  const address = hostname(value);
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family !== 6) return false;
  // WHATWG URL canonicalizes mapped IPv4 to two hexadecimal groups.
  const normalized = new URL(`http://[${address}]`).hostname.slice(1, -1);
  if (normalized.startsWith("::ffff:")) {
    const parts = normalized
      .slice(7)
      .split(":")
      .map((s) => Number.parseInt(s, 16));
    if (parts.length !== 2) return false;
    const [a = 0, b = 0] = parts;
    return isPublicAddress(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
  }
  return globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}
export function normalizeProviderUrl(
  value: string,
  policy: ProviderNetworkPolicy,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ChatProviderError("provider_blocked_address");
  }
  const host = hostname(url.hostname);
  if (
    value.length > 300 ||
    /[\s\\?#]/.test(value) ||
    (url.protocol !== "https:" &&
      !(policy.allowHttp && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    !host ||
    (isIP(host)
      ? !isPublicAddress(host)
      : !host.includes(".") ||
        /\.(localhost|local|internal|test|invalid)$/.test(host)) ||
    (policy.allowedHosts?.length &&
      !policy.allowedHosts.some((h) => hostname(h) === host)) ||
    policy.forbiddenUrls?.some((u) => {
      try {
        return hostname(new URL(u).hostname) === host;
      } catch {
        return false;
      }
    })
  )
    throw new ChatProviderError("provider_blocked_address");
  url.hostname = isIP(host) === 6 ? `[${host}]` : host;
  return url.href.replace(/\/+$/, "");
}
export type ResolveAddresses = (
  host: string,
) => Promise<Array<{ address: string; family: number }>>;
export function createSafeLookup(
  resolve: ResolveAddresses = (host) =>
    dnsLookup(host, { all: true, verbatim: true }),
): LookupFunction {
  return (host, options, callback) => {
    void resolve(host)
      .then((addresses) => {
        if (
          !addresses.length ||
          addresses.some((a) => !isPublicAddress(a.address))
        )
          throw new ChatProviderError("provider_blocked_address");
        const candidates = options.family
          ? addresses.filter((a) => a.family === options.family)
          : addresses;
        if (!candidates.length)
          throw new ChatProviderError("provider_unreachable");
        if (options.all) callback(null, candidates);
        else {
          const first = candidates[0];
          if (!first) throw new ChatProviderError("provider_unreachable");
          callback(null, first.address, first.family);
        }
      })
      .catch((error) => callback(mapProviderConnectionError(error), ""));
  };
}

export function createProviderNetwork(
  policy: ProviderNetworkPolicy,
  options: {
    fetch?: typeof httpFetch;
    resolve?: ResolveAddresses;
  } = {},
) {
  // Deliberately no environment proxy: a proxy-side DNS lookup would bypass this guard.
  const dispatcher = new Agent({
    connect: { lookup: createSafeLookup(options.resolve), timeout: 10_000 },
    headersTimeout: 60_000,
    bodyTimeout: 60_000,
    connections: 4,
    maxOrigins: 100,
  });
  const fetcher = options.fetch ?? httpFetch;
  function transport(baseUrl: string, apiKey: string): typeof globalThis.fetch {
    const base = normalizeProviderUrl(baseUrl, policy);
    return async (input, init) => {
      const target = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const models = target.href === `${base}/models`;
      if (!models && target.href !== `${base}/chat/completions`)
        throw new ChatProviderError("provider_blocked_address");
      // Revalidate configuration on every request, including literal IPs (which skip lookup).
      normalizeProviderUrl(base, policy);
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${apiKey}`);
      headers.set("User-Agent", "GGUUImageServer/1.0");
      const timeout = AbortSignal.timeout(models ? 10_000 : 600_000);
      const signal = init?.signal
        ? AbortSignal.any([init.signal, timeout])
        : timeout;
      try {
        const response = await fetcher(target, {
          ...init,
          headers,
          signal,
          dispatcher,
          redirect: "error",
        } as Parameters<typeof httpFetch>[1]);
        if (!response.ok) {
          const body = (
            await readLimitedBody(response, 2 * 1024 * 1024).catch(() =>
              Buffer.alloc(0),
            )
          ).toString();
          throw mapProviderStatus(response.status, body, models);
        }
        return response as unknown as Response;
      } catch (error) {
        throw mapProviderConnectionError(error);
      }
    };
  }
  async function listModels(
    baseUrl: string,
    apiKey: string,
  ): Promise<string[]> {
    const response = await transport(
      baseUrl,
      apiKey,
    )(`${normalizeProviderUrl(baseUrl, policy)}/models`);
    let data: unknown;
    try {
      data = JSON.parse(
        (
          await readLimitedBody(
            response as unknown as import("undici").Response,
            2 * 1024 * 1024,
          )
        ).toString(),
      );
    } catch {
      throw new ChatProviderError("provider_models_unavailable");
    }
    if (
      !data ||
      typeof data !== "object" ||
      !("data" in data) ||
      !Array.isArray(data.data)
    )
      throw new ChatProviderError("provider_models_unavailable");
    const models = [
      ...new Set(
        data.data.flatMap((m: unknown) =>
          m &&
          typeof m === "object" &&
          "id" in m &&
          typeof m.id === "string" &&
          m.id.trim() &&
          m.id.length <= 200 &&
          !hasControlCharacters(m.id)
            ? [m.id]
            : [],
        ),
      ),
    ].slice(0, 200);
    if (!models.length)
      throw new ChatProviderError("provider_models_unavailable");
    return models;
  }
  return {
    normalize: (url: string) => normalizeProviderUrl(url, policy),
    transport,
    listModels,
    close: () => dispatcher.close(),
  };
}
export type ProviderNetwork = ReturnType<typeof createProviderNetwork>;
