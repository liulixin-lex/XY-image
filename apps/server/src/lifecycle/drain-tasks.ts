import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    /** Refuse new agent runs and wait for accepted ones (restart, server.ts). */
    drainAgentRuns(): Promise<void>;
  }
}

/** Keep accepted background runs alive through their final persistence step. */
export function registerTaskDrain(app: FastifyInstance) {
  const active = new Set<Promise<void>>();
  let draining = false;
  let drained: Promise<void> | undefined;

  // A restart drains before app.close(): Fastify runs close hooks under its
  // plugin timeout (10 s), and a preClose that took longer stalled the whole
  // close — WebSocket clients were never closed and server.close() never ran,
  // so the process hung until the deadline. Runs often take longer than 10 s.
  const drain = () => {
    drained ??= (async () => {
      draining = true;
      const started = Date.now();
      app.log.info(
        { active: active.size },
        "[server] Draining active agent runs",
      );
      await Promise.allSettled(active);
      app.log.info(
        { elapsedMs: Date.now() - started },
        "[server] Agent runs drained",
      );
    })();
    return drained;
  };
  app.decorate("drainAgentRuns", drain);

  // Direct app.close() callers (tests, failed startup) still drain first:
  // root preClose runs before the WebSocket plugin closes its connections, so
  // existing runs can still receive browser RPC replies while finishing.
  app.addHook("preClose", () => drain());

  return {
    /** True once draining starts: new runs are refused, the rest is served. */
    isDraining: () => draining,
    run(task: () => Promise<void>): Promise<void> | null {
      if (draining) return null;
      const pending = Promise.resolve()
        .then(task)
        .finally(() => {
          active.delete(pending);
        });
      active.add(pending);
      return pending;
    },
  };
}

export type TaskDrain = ReturnType<typeof registerTaskDrain>;
