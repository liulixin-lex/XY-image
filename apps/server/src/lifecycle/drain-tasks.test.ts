import { once } from "node:events";
import type { AddressInfo } from "node:net";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { registerTaskDrain } from "./drain-tasks.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("active task shutdown", () => {
  it("waits for accepted work and rejects new work before closing resources", async () => {
    const app = Fastify();
    const drain = registerTaskDrain(app);
    const gate = deferred();
    const resourceClose = vi.fn();
    app.addHook("onClose", async () => {
      resourceClose();
    });
    await app.ready();
    const task = drain.run(() => gate.promise);
    const closed = app.close();
    await new Promise((resolve) => setImmediate(resolve));
    const newTask = vi.fn(async () => {});
    expect(drain.run(newTask)).toBeNull();
    expect(newTask).not.toHaveBeenCalled();
    expect(resourceClose).not.toHaveBeenCalled();
    gate.resolve();
    await task;
    await closed;
    expect(resourceClose).toHaveBeenCalledOnce();
  });

  it("settles failed work without skipping resource cleanup", async () => {
    const app = Fastify();
    const drain = registerTaskDrain(app);
    await app.ready();
    const pending = drain.run(async () => {
      throw new Error("synthetic");
    });
    await expect(pending).rejects.toThrow("synthetic");
    await app.close();
    expect(drain.run(async () => {})).toBeNull();
  });

  it("drains longer than Fastify's plugin timeout and still closes WebSockets", async () => {
    // Close hooks run under pluginTimeout (10 s by default); a preClose that
    // outlasted it stalled the close. A restart drains before app.close().
    const app = Fastify({ pluginTimeout: 100 });
    const drain = registerTaskDrain(app);
    await app.register(async (instance) => {
      await instance.register(websocket);
      instance.get("/ws", { websocket: true }, () => {});
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    try {
      await once(client, "open");
      const clientClosed = once(client, "close");
      const gate = deferred();
      const task = drain.run(() => gate.promise);
      const drained = app.drainAgentRuns();
      expect(drain.isDraining()).toBe(true);
      setTimeout(gate.resolve, 300);
      await drained;
      await task;
      // The browser stays connected while its run finishes.
      expect(client.readyState).toBe(WebSocket.OPEN);
      await app.close();
      await clientClosed;
    } finally {
      client.terminate();
      await app.close();
    }
  });
});
