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
  app.log.info("[server] Draining connections");
  const deadline = setTimeout(() => process.exit(1), 700_000);
  deadline.unref();
  try {
    await app.close();
    await closeSupabaseTransport();
    process.exit(0);
  } catch {
    app.log.error("[server] Shutdown failed");
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
