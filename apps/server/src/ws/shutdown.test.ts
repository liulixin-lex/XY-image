import { once } from "node:events";
import websocket from "@fastify/websocket";
import type { StreamEvent } from "@loomic/shared";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AgentRunService } from "../agent/runtime.js";
import type { ChatService } from "../features/chat/chat-service.js";
import { registerTaskDrain } from "../lifecycle/drain-tasks.js";
import type { UserSupabaseClient } from "../supabase/user.js";
import { ConnectionManager } from "./connection-manager.js";
import { registerWsRoute } from "./handler.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("drains an accepted WebSocket run and final message before closing resources", async () => {
  const app = Fastify();
  const taskDrain = registerTaskDrain(app);
  const streaming = deferred();
  const persistence = deferred();
  const createMessage = vi.fn(async () => {
    await persistence.promise;
  });
  const manager = new ConnectionManager();
  const createRun = vi.fn(() => ({
    runId: "run-1",
    sessionId: "session-1",
    conversationId: "canvas-1",
    status: "accepted",
  }));
  const agentRuns = {
    createRun,
    streamRun: async function* (): AsyncGenerator<StreamEvent> {
      await streaming.promise;
      yield {
        type: "message.delta",
        messageId: "message-1",
        delta: "finished",
        runId: "run-1",
        timestamp: new Date().toISOString(),
      };
      yield {
        type: "run.completed",
        runId: "run-1",
        timestamp: new Date().toISOString(),
      };
    },
  } as unknown as AgentRunService;
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: { id: "canvas-1" }, error: null }),
  };
  const closedResources = vi.fn();
  app.addHook("onClose", async () => {
    closedResources();
  });
  await app.register(async (instance) => {
    await instance.register(websocket);
    await registerWsRoute(instance, {
      agentRuns,
      taskDrain,
      connectionManager: manager,
      auth: {
        authenticate: async () => ({
          id: "user-1",
          accessToken: "synthetic-session",
          email: "synthetic@example.com",
          userMetadata: {},
        }),
      },
      createUserClient: () =>
        ({ from: () => query }) as unknown as UserSupabaseClient,
      chatService: { createMessage } as unknown as ChatService,
    });
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/api/ws?token=synthetic-session&connectionId=test`,
  );
  const messages: Record<string, unknown>[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
  let closing: Promise<void> | undefined;
  try {
    await once(socket, "open");
    await vi.waitFor(() => expect(manager.get("test")).toBeDefined());
    const command = {
      type: "command",
      action: "agent.run",
      payload: {
        sessionId: "session-1",
        conversationId: "canvas-1",
        canvasId: "canvas-1",
        prompt: "hello",
      },
    };
    socket.send(JSON.stringify(command));
    await vi.waitFor(() =>
      expect(manager.getActiveRun("canvas-1")).toMatchObject({
        runId: "run-1",
      }),
    );
    closing = app.close();
    await new Promise((resolve) => setImmediate(resolve));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(closedResources).not.toHaveBeenCalled();
    socket.send(JSON.stringify(command));
    await vi.waitFor(() =>
      expect(
        messages.some(
          (message) => message.message === "服务正在维护，请稍后再试",
        ),
      ).toBe(true),
    );
    expect(createRun).toHaveBeenCalledOnce();
    // A browser disconnect does not cancel paid work or skip final persistence.
    socket.close();
    streaming.resolve();
    await vi.waitFor(() => expect(createMessage).toHaveBeenCalledOnce());
    expect(closedResources).not.toHaveBeenCalled();
    persistence.resolve();
    await closing;
    expect(closedResources).toHaveBeenCalledOnce();
    expect(manager.getActiveRun("canvas-1")).toBeNull();
    expect(createMessage).toHaveBeenCalledWith(
      expect.any(Object),
      "session-1",
      expect.objectContaining({ content: "finished", role: "assistant" }),
    );
  } finally {
    streaming.resolve();
    persistence.resolve();
    socket.terminate();
    await (closing ?? app.close());
  }
});
