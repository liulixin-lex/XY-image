import { once } from "node:events";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AgentRunService } from "../agent/runtime.js";
import { registerTaskDrain } from "../lifecycle/drain-tasks.js";
import type { UserSupabaseClient } from "../supabase/user.js";
import { ConnectionManager } from "./connection-manager.js";
import { registerWsRoute } from "./handler.js";

/**
 * The token check on connect is async. Commands a client sends right after
 * `open` used to be dropped silently (found by the lab isolation drill: a
 * canvas.resume got no answer at all).
 */

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function startServer() {
  let release!: () => void;
  const tokenChecked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let checks = 0;
  const app = Fastify();
  const taskDrain = registerTaskDrain(app);
  const manager = new ConnectionManager();
  const canvasQuery = (id: string) => ({
    maybeSingle: async () => ({
      data: id === "canvas-own" ? { id } : null,
      error: null,
    }),
  });
  await app.register(async (instance) => {
    await instance.register(websocket);
    await registerWsRoute(instance, {
      agentRuns: {} as unknown as AgentRunService,
      taskDrain,
      connectionManager: manager,
      auth: {
        authenticate: async () => {
          // Only the check on connect waits; each command checks again.
          if (checks++ === 0) await tokenChecked;
          return {
            id: "user-1",
            accessToken: "synthetic-session",
            email: "synthetic@example.com",
            userMetadata: {},
          };
        },
      },
      createUserClient: () =>
        ({
          from: () => ({
            select: () => ({
              eq: (_column: string, id: string) => canvasQuery(id),
            }),
          }),
        }) as unknown as UserSupabaseClient,
    });
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  close = () => app.close();
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/api/ws?token=synthetic-session&connectionId=early`,
  );
  const messages: Record<string, unknown>[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await once(socket, "open");
  return { socket, messages, manager, release };
}

const resume = (canvasId: string) =>
  JSON.stringify({
    type: "command",
    action: "canvas.resume",
    payload: { canvasId, lastSeq: 0 },
  });

it("answers commands sent while the token is still being checked", async () => {
  const { socket, messages, manager, release } = await startServer();
  socket.send(resume("canvas-own"));
  socket.send(resume("canvas-other"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(manager.get("early")).toBeUndefined();
  expect(messages).toEqual([]);

  release();
  await vi.waitFor(() => expect(messages).toHaveLength(2));
  expect(messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "command.ack",
        action: "canvas.resume",
        payload: expect.objectContaining({ canvasId: "canvas-own" }),
      }),
      { type: "error", message: "无权访问此画布" },
    ]),
  );
  // After binding, commands go straight to the handler.
  socket.send(resume("canvas-own"));
  await vi.waitFor(() => expect(messages).toHaveLength(3));
  socket.close();
});

it("closes a connection that floods commands before its token is checked", async () => {
  const { socket, release } = await startServer();
  const closed = once(socket, "close");
  for (let i = 0; i < 33; i++) socket.send(resume("canvas-own"));
  const [code] = await closed;
  expect(code).toBe(1008);
  release();
});
