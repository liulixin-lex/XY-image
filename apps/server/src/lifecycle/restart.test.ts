import { randomBytes } from "node:crypto";
import { once } from "node:events";
import net, { type AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { buildApp } from "../app.js";

// A restart (SIGTERM, server.ts) drains agent runs, then closes the server.
// The page reconnects its WebSocket whenever the socket drops, so a reconnect
// can arrive while the server closes. It used to get Fastify's closing 503,
// which skips @fastify/websocket's hooks: the socket stayed open after the
// proxy half-closed it, and server.close() waited for it for minutes.
it("keeps serving while a restart drains, and a reconnect does not hold the close", async () => {
  const app = buildApp({
    env: {
      xy2apiBaseUrl: "https://example.com",
      secretKey: randomBytes(32).toString("base64"),
      ssoEmailDomain: "sso.example.com",
    },
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Holds the close open while the reconnect arrives.
  app.addHook("preClose", async () => held);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const closing = app.close();
  try {
    await vi.waitFor(async () => {
      const ready = await fetch(`${base}/api/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({
        checks: { accepting: false },
      });
    });
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    // New agent runs wait for the new process.
    const run = await fetch(`${base}/api/agent/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(run.status).toBe(503);
    expect(run.headers.get("retry-after")).toBe("30");

    // A reconnect through a proxy that half-closes once it has an answer.
    const socket = net.connect(port, "127.0.0.1");
    await once(socket, "connect");
    socket.write(
      [
        "GET /api/ws HTTP/1.1",
        "Host: api.test",
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"),
    );
    const [answer] = await once(socket, "data");
    expect(String(answer)).toMatch(/^HTTP\/1\.1 101/);
    socket.end();
    const socketClosed = once(socket, "close");

    release();
    const outcome = await Promise.race([
      closing.then(() => "closed"),
      new Promise((resolve) => setTimeout(resolve, 5_000, "still open")),
    ]);
    expect(outcome).toBe("closed");
    await socketClosed;
  } finally {
    release();
    await closing;
  }
});
