// @vitest-environment jsdom
/**
 * The provider API client: the key leaves once, in the request body, and is
 * never logged or stored; an older server (no endpoints) is recognised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../src/lib/chat-providers-api";
import { ApiApplicationError } from "../src/lib/server-api";

const SECRET = "sk-test-secret-0042";

describe("chat-providers-api", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://api.test"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("recognises an older server by Fastify's bare 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ message: "Route GET:/api/chat-providers not found", error: "Not Found", statusCode: 404 }, { status: 404 }),
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = await api.fetchChatProviders("t").catch((e: unknown) => e);
    expect(api.isEndpointMissing(error)).toBe(true);
    expect(api.isEndpointMissing(new ApiApplicationError("provider_not_found", "x", 404))).toBe(false);
  });

  it("sends the key once in the body and never logs it, even on failure", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ error: { code: "provider_auth_failed", message: "rejected" } }, { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const logged: unknown[] = [];
    for (const level of ["log", "info", "warn", "error"] as const)
      vi.spyOn(console, level).mockImplementation((...args) => logged.push(...args));

    const error = await api
      .createChatProvider("t", { name: "n", protocol: "openai_compatible", baseUrl: "https://a.com/v1", apiKey: SECRET })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiApplicationError);
    expect((error as ApiApplicationError).code).toBe("provider_auth_failed");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/api/chat-providers");
    expect(JSON.parse(String(init?.body))).toMatchObject({ apiKey: SECRET });
    expect(JSON.stringify(logged)).not.toContain(SECRET);
    expect(JSON.stringify(localStorage)).not.toContain(SECRET);
  });
});
