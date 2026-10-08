import type { FastifyInstance } from "fastify";

/** Keep accepted background runs alive through their final persistence step. */
export function registerTaskDrain(app: FastifyInstance) {
  const active = new Set<Promise<void>>();
  let draining = false;

  // Root preClose runs before the WebSocket plugin closes its connections.
  // Existing runs can still receive browser RPC replies while finishing.
  app.addHook("preClose", async () => {
    draining = true;
    app.log.info(
      { active: active.size },
      "[server] Draining active agent runs",
    );
    await Promise.allSettled(active);
  });

  return {
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
