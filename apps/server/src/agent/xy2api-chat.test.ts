import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createStreamingChatModel } from "./deep-agent.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

async function gateway(status = 200) {
  const requests: Array<{
    auth: string | undefined;
    ua: string | undefined;
    path: string | undefined;
  }> = [];
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Drain the SDK request body. */
    }
    requests.push({
      auth: request.headers.authorization,
      ua: request.headers["user-agent"],
      path: request.url,
    });
    if (status !== 200) {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: { type: "server_error", message: "private-upstream-detail" },
        }),
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = {
      id: "chat-fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: "gpt-4.1",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "连接正常" },
          finish_reason: null,
        },
      ],
    };
    response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return {
    requests,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

describe("per-user chat transport", () => {
  it("isolates concurrent credentials and excludes them from serialized models", async () => {
    const server = await gateway();
    const keys = ["synthetic-chat-user-a", "synthetic-chat-user-b"];
    const models = keys.map((apiKey) =>
      createStreamingChatModel("openai:gpt-4.1", {
        apiKey,
        baseUrl: server.baseUrl,
      }),
    );
    for (const model of models) {
      const serialized = JSON.stringify(model.toJSON());
      for (const key of keys) expect(serialized).not.toContain(key);
    }
    const results = await Promise.all(
      models.map((model) => model.invoke("test")),
    );
    expect(results.map((result) => result.content)).toEqual([
      "连接正常",
      "连接正常",
    ]);
    expect(server.requests.map((request) => request.auth).sort()).toEqual(
      keys.map((key) => `Bearer ${key}`).sort(),
    );
    expect(
      server.requests.every(
        (request) =>
          request.ua === "LoomicServer/1.0" &&
          request.path === "/v1/chat/completions",
      ),
    ).toBe(true);
  });
  it("uses Responses for GPT-6, sanitizes gateway failures, and never retries", async () => {
    const server = await gateway(503);
    const model = createStreamingChatModel("openai:gpt-6-sol", {
      apiKey: "synthetic-chat-secret",
      baseUrl: server.baseUrl,
    });
    try {
      await model.invoke("test");
      expect.fail("Expected the upstream request to fail");
    } catch (error) {
      expect(String(error)).not.toContain("private-upstream-detail");
      expect(String(error)).not.toContain("synthetic-chat-secret");
    }
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.path).toBe("/v1/responses");
  });
});
