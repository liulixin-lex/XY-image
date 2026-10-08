import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
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
});
