import { bootstrap } from "global-agent";

// Enable HTTP proxy for all outbound requests if http_proxy / https_proxy is set
bootstrap();

// Native fetch() proxy — needed for @google/generative-ai SDK
if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.GLOBAL_AGENT_HTTP_PROXY));
}

import { buildApp } from "./app.js";
import { loadServerEnv } from "./config/env.js";
import { validateProductionEnv } from "./config/production.js";
import { closeSupabaseTransport } from "./supabase/transport.js";
import { describeErrorForLog } from "./utils/error-sanitizer.js";

const env = loadServerEnv();
validateProductionEnv(env);
const app = buildApp({
  env,
});

const host = process.env.HOST ?? "127.0.0.1";
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const started = Date.now();
  const elapsedMs = () => Date.now() - started;
  let phase: "draining" | "closing" = "draining";
  app.log.info("[server] Shutting down");
  const deadline = setTimeout(() => {
    app.log.error({ elapsedMs: elapsedMs() }, "[server] Shutdown timed out");
    process.exit(1);
  }, 700_000);
  deadline.unref();
  // A restart that does not finish says what it is still waiting for. Open
  // connections are expected while runs drain, not once the server closes.
  const progress = setInterval(() => {
    app.server.getConnections((_error, connections) => {
      const fields = { elapsedMs: elapsedMs(), phase, connections };
      if (phase === "draining") app.log.info(fields, "[server] Still draining");
      else app.log.warn(fields, "[server] Still closing");
    });
  }, 30_000);
  progress.unref();
  try {
    // Runs first, outside Fastify's close hooks (see lifecycle/drain-tasks).
    await app.drainAgentRuns();
    phase = "closing";
    await app.close();
    clearInterval(progress);
    app.log.info({ elapsedMs: elapsedMs() }, "[server] Closed");
    await closeSupabaseTransport();
    app.log.info({ elapsedMs: elapsedMs() }, "[server] Shutdown complete");
    process.exit(0);
  } catch (error) {
    app.log.error(
      { elapsedMs: elapsedMs(), error: describeErrorForLog(error) },
      "[server] Shutdown failed",
    );
    process.exit(1);
  }
}
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});

try {
  await app.listen({
    host,
    port: env.port,
  });

  console.log(`@loomic/server listening on http://${host}:${env.port}`);
} catch (error) {
  app.log.error(`[server] Startup failed: ${describeErrorForLog(error)}`);
  await app.close();
  process.exitCode = 1;
}
