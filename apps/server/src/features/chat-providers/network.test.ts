import type { LookupAddress } from "node:dns";
import { Response, type fetch as httpFetch } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createCustomChatModel } from "./chat-model.js";
import { mapProviderStatus } from "./errors.js";
import {
  createProviderNetwork,
  createSafeLookup,
  isPublicAddress,
  normalizeProviderUrl,
} from "./network.js";

const networks: ReturnType<typeof createProviderNetwork>[] = [];
afterEach(async () => {
  await Promise.all(networks.splice(0).map((n) => n.close()));
});
function network(fetcher?: typeof httpFetch) {
  const n = createProviderNetwork({}, fetcher ? { fetch: fetcher } : {});
  networks.push(n);
  return n;
}
describe("provider egress policy", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.0.1",
    "224.0.0.1",
    "240.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "203.0.113.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:a00:1",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "2001:db8::1",
    "3fff::1",
  ])("blocks reserved IP %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:808:808"])(
    "accepts global IP %s",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    },
  );
  it.each([
    "http://api.example.com/v1",
    "https://u:p@api.example.com/v1",
    "https://api.example.com/v1?",
    "https://api.example.com/v1#x",
    "https://127.1/v1",
    "https://0x7f000001/v1",
    "https://[::1]/v1",
    "https://localhost./v1",
    "https://metadata.google.internal/v1",
    "https://api.example.com/with space",
    "https://api.example.com\\@127.0.0.1/v1",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => normalizeProviderUrl(url, {})).toThrow();
  });
  it("normalizes URLs and treats the optional allowlist as a restriction, never a private-IP bypass", () => {
    expect(normalizeProviderUrl("https://API.EXAMPLE.COM/v1///", {})).toBe(
      "https://api.example.com/v1",
    );
    expect(() =>
      normalizeProviderUrl("https://api.example.com/v1", {
        allowedHosts: ["other.example.com"],
      }),
    ).toThrow();
    expect(() =>
      normalizeProviderUrl("https://main.example.com./v1", {
        forbiddenUrls: ["https://main.example.com"],
      }),
    ).toThrow();
    expect(() =>
      normalizeProviderUrl("https://127.0.0.1", {
        allowedHosts: ["127.0.0.1"],
      }),
    ).toThrow();
    expect(
      normalizeProviderUrl("http://api.example.com/v1", { allowHttp: true }),
    ).toBe("http://api.example.com/v1");
  });
  it("rechecks DNS per connection and rejects mixed public/private records", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]);
    const lookup = createSafeLookup(resolver);
    const call = () =>
      new Promise<string | LookupAddress[]>((resolve, reject) => {
        lookup("rebind.example.com", { all: true }, (error, address) =>
          error ? reject(error) : resolve(address),
        );
      });
    await expect(call()).resolves.toEqual([{ address: "8.8.8.8", family: 4 }]);
    await expect(call()).rejects.toMatchObject({
      code: "provider_blocked_address",
    });
  });
  it("the actual undici connector refuses rebound private DNS before opening a socket", async () => {
    const resolver = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
    const n = createProviderNetwork({}, { resolve: resolver });
    networks.push(n);
    await expect(
      n.listModels("https://rebind.example.com/v1", "synthetic-key"),
    ).rejects.toMatchObject({ code: "provider_blocked_address" });
    expect(resolver).toHaveBeenCalled();
  });
  it("bounds model discovery and injects credentials only into the correct endpoint", async () => {
    const fetcher = vi.fn<typeof httpFetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: "org/model:free" }, { id: "org/model:free" }],
        }),
      ),
    );
    const n = network(fetcher);
    expect(
      await n.listModels("https://api.example.com/v1", "synthetic-private-key"),
    ).toEqual(["org/model:free"]);
    expect(
      new Headers(
        fetcher.mock.calls[0]?.[1]?.headers as ConstructorParameters<
          typeof Headers
        >[0],
      ).get("Authorization"),
    ).toBe("Bearer synthetic-private-key");
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
    await expect(
      n.transport(
        "https://api.example.com/v1",
        "secret",
      )("https://other.example.com/v1/models"),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(
      new Response("oversized", { headers: { "content-length": "3000000" } }),
    );
    await expect(
      n.listModels("https://api.example.com/v1", "synthetic-private-key"),
    ).rejects.toMatchObject({ code: "provider_models_unavailable" });
  });
  it.each([
    [401, "provider_auth_failed"],
    [403, "provider_auth_failed"],
    [404, "provider_model_not_found"],
    [429, "provider_rate_limited"],
    [503, "provider_unavailable"],
    [400, "provider_tools_unsupported"],
  ] as const)(
    "maps status %s and excludes upstream secrets",
    (status, code) => {
      const error = mapProviderStatus(
        status,
        "synthetic-private-key tools are not supported",
      );
      expect(error.code).toBe(code);
      expect(JSON.stringify(error)).not.toContain("synthetic-private-key");
    },
  );
  it("streams compatible tool calls through the real SDK without exposing the credential", async () => {
    const chunk = {
      id: "fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: "gpt-6-sol",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call-fixture",
                type: "function",
                function: { name: "inspect_canvas", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const fetcher = vi.fn<typeof httpFetch>().mockResolvedValueOnce(
      new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const n = network(fetcher);
    const model = createCustomChatModel({
      model: "gpt-6-sol",
      baseUrl: "https://api.example.com/v1",
      transport: n.transport(
        "https://api.example.com/v1",
        "synthetic-provider-key",
      ),
    });
    const result = await model
      .bindTools([
        {
          name: "inspect_canvas",
          description: "Read the canvas",
          schema: z.object({}),
        },
      ])
      .invoke("Read");
    expect(result.tool_calls).toEqual([
      {
        id: "call-fixture",
        name: "inspect_canvas",
        args: {},
        type: "tool_call",
      },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("synthetic-provider-key");
  });
  it("SDK uses chat completions for GPT-6 custom models, isolates keys, and never retries", async () => {
    const fetcher = vi
      .fn<typeof httpFetch>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ error: { message: "synthetic-private-key" } }),
            { status: 503 },
          ),
      );
    const n = network(fetcher);
    const keys = ["synthetic-key-user-a", "synthetic-key-user-b"];
    const models = keys.map((key) =>
      createCustomChatModel({
        model: "gpt-6-sol",
        baseUrl: "https://api.example.com/v1",
        transport: n.transport("https://api.example.com/v1", key),
      }),
    );
    for (const model of models)
      for (const key of keys)
        expect(JSON.stringify(model.toJSON())).not.toContain(key);
    const results = await Promise.allSettled(
      models.map((m) => m.invoke("test")),
    );
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls
        .map((c) =>
          new Headers(
            c[1]?.headers as ConstructorParameters<typeof Headers>[0],
          ).get("Authorization"),
        )
        .sort(),
    ).toEqual(keys.map((k) => `Bearer ${k}`).sort());
    expect(
      fetcher.mock.calls.every((c) =>
        String(c[0]).endsWith("/v1/chat/completions"),
      ),
    ).toBe(true);
  });
});
