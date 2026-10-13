import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { parseS3Settings, settingsEnv, storageEnvironment } from "./object-storage.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
/**
 * The vendored volume files are read inside the containers by their own users
 * (Postgres runs the init scripts as uid 100, not root). `cp` keeps the mode of
 * the checkout, so a checkout made with umask 077 (or synced as 0600) produced
 * 0600 init scripts: the database stopped at 98-webhooks.sql with "Permission
 * denied", the rest of Supabase's init never ran, and Storage later failed with
 * `permission denied to set role "service_role"` (pre-launch server, 2026-10-11).
 * None of these files hold secrets (those live in .env, 0600), so make them
 * world-readable: directories 0755, files 0644, executables 0755.
 */
export async function normalizeVolumeModes(dir) {
  await chmod(dir, 0o755);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await normalizeVolumeModes(file);
    else if (entry.isFile())
      await chmod(file, (await stat(file)).mode & 0o111 ? 0o755 : 0o644);
  }
}
function origin(value, label) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw new Error(`${label} must be an HTTPS origin`);
  return u.origin;
}
function token(role, secret) {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, iss: "supabase", iat: now, exp: now + 10 * 365 * 86400 })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
// Cloudflare's published edge ranges (https://www.cloudflare.com/ips/, read
// 2026-10-09). TODO: refresh when Cloudflare announces a change. A stale list
// only leaves some edges untrusted (they share one limiter budget); it never
// lets a client choose its own address.
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];
/** Nginx realip settings for the CDN in front of the public hosts (M3). */
export function realIpBlock(cdn) {
  if (!cdn)
    return "# No CDN: $remote_addr is the client. Behind Cloudflare, prepare with --cdn cloudflare.";
  if (cdn !== "cloudflare")
    throw new Error("Unsupported cdn; use cloudflare or omit it");
  return [
    "# Cloudflare in front (prepare --cdn cloudflare).",
    ...CLOUDFLARE_RANGES.map((range) => `set_real_ip_from ${range};`),
    "real_ip_header CF-Connecting-IP;",
  ].join("\n");
}
/**
 * Where the public origins point. Three hosts (web, API, Supabase) is the
 * original layout. With `origin`, one host serves all three: the static
 * site at the root, XY API under /api and Supabase under /supabase (the
 * pre-launch server's layout since 2026-10-11, set up by hand until this).
 * The code already accepts a SUPABASE_URL with a path (reference downloads,
 * /api/proxy-image, the browser's own-storage check).
 */
export function publicOrigins(options) {
  const split = ["webOrigin", "apiOrigin", "supabaseOrigin"].filter(
    (k) => options[k],
  );
  if (options.origin) {
    if (split.length)
      throw new Error(
        "Use either --origin (one domain) or --web-origin/--api-origin/--supabase-origin",
      );
    const site = origin(options.origin, "origin");
    return {
      mode: "single",
      web: site,
      api: site,
      supabase: `${site}/supabase`,
    };
  }
  if (split.length !== 3)
    throw new Error(
      "Give --origin for one domain, or all of --web-origin, --api-origin and --supabase-origin",
    );
  const web = origin(options.webOrigin, "web-origin");
  const api = origin(options.apiOrigin, "api-origin");
  const supabase = origin(options.supabaseOrigin, "supabase-origin");
  if (new Set([web, api, supabase]).size !== 3)
    throw new Error(
      "Use three distinct public origins, or --origin for a single domain",
    );
  return { mode: "split", web, api, supabase };
}
/** The static site's directory on the host (single-domain configs serve it). */
function webRootPath(value = "/var/www/xy-image") {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(value) || value.split("/").includes(".."))
    throw new Error("web-root must be an absolute path without spaces or ..");
  return value.replace(/\/+$/, "") || "/";
}
/**
 * Loopback ports on the host for XY API and the Supabase gateway. The defaults
 * (3101, 18000) are what the templates and the first deployments use; give
 * other ports to run a second deployment on the same host (the pre-launch
 * server runs the test site and the production site side by side).
 */
export function hostPorts(options = {}) {
  const port = (value, fallback, label) => {
    const n = Number(value ?? fallback);
    if (!Number.isInteger(n) || n < 1024 || n > 65535)
      throw new Error(`${label} must be a port between 1024 and 65535`);
    return n;
  };
  const api = port(options.apiPort, 3101, "api-port");
  const gateway = port(options.gatewayPort, 18000, "gateway-port");
  if (api === gateway) throw new Error("api-port and gateway-port must differ");
  return { api, gateway };
}
/** Points the edge templates at the deployment's loopback ports. */
const withPorts = (text, ports) =>
  text
    .replaceAll("127.0.0.1:3101", `127.0.0.1:${ports.api}`)
    .replaceAll("127.0.0.1:18000", `127.0.0.1:${ports.gateway}`);
/** The xy2api main site this deployment signs in against and bills through. */
function xy2apiOrigin(value = "https://gguuai.com") {
  return origin(value, "xy2api-url");
}
/** Host configs for a single-domain deployment: Nginx and Caddy. */
export async function singleDomainConfigs({
  host,
  webRoot,
  realIp,
  ports = hostPorts(),
}) {
  const fill = (text) =>
    withPorts(
      text.replaceAll("__HOST__", host).replaceAll("__WEB_ROOT__", webRoot),
      ports,
    );
  return {
    nginx: fill(
      await readFile(path.join(here, "nginx.single.conf.template"), "utf8"),
    ).replace("# __REAL_IP__", realIp),
    caddy: fill(
      await readFile(path.join(here, "Caddyfile.single.template"), "utf8"),
    ),
  };
}
const envText = (values) =>
  `${Object.entries(values)
    .map(([k, v]) => {
      if (/[\r\n']/.test(String(v)))
        throw new Error(`Invalid environment value for ${k}`);
      return `${k}='${v}'`;
    })
    .join("\n")}\n`;
export async function prepare(options) {
  const target = path.resolve(options.dir);
  if (target === repository || target.startsWith(repository + path.sep))
    throw new Error("Deployment directory must be outside the repository");
  if (!/^[a-z][a-z0-9-]{2,30}$/.test(options.project ?? "xy-image"))
    throw new Error("Invalid project name");
  const project = options.project ?? "xy-image";
  const { mode, web, api, supabase } = publicOrigins(options);
  const webRoot = mode === "single" ? webRootPath(options.webRoot) : null;
  const realIp = realIpBlock(options.cdn);
  const ports = hostPorts(options);
  const xy2api = xy2apiOrigin(options.xy2apiUrl);
  // Object storage (第 59 条): files on this disk (default) or an
  // S3-compatible bucket such as R2 from the start. Existing deployments
  // move with object-storage.mjs instead.
  const objectStorage = options.objectStorage ?? "local";
  if (!["local", "s3"].includes(objectStorage))
    throw new Error("object-storage must be local or s3");
  if ((objectStorage === "s3") !== Boolean(options.s3))
    throw new Error("--object-storage s3 needs --s3-credentials <file>, and only then");
  if (
    !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(
      options.ssoDomain,
    )
  )
    throw new Error("Invalid sso-domain");
  const upstream = JSON.parse(
    await readFile(path.join(here, "vendor/manifest.json"), "utf8"),
  );
  for (const [file, expected] of Object.entries(upstream.files)) {
    const content = await readFile(path.join(here, "vendor", file));
    if (createHash("sha256").update(content).digest("hex") !== expected)
      throw new Error(`Vendor checksum mismatch: ${file}`);
  }
  const base = JSON.parse(
    await readFile(path.join(here, "vendor/compose.base.json"), "utf8"),
  );
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(target, { mode: 0o700 }); // Refuse existing directories; never rotate secrets accidentally.
  try {
    await cp(path.join(here, "vendor/volumes"), path.join(target, "volumes"), {
      recursive: true,
    });
    // Patch generated gateway logging: Realtime query parameters can contain tokens.
    const gatewayFile = path.join(
      target,
      "volumes/api/envoy/lds.template.yaml",
    );
    let gateway = await readFile(gatewayFile, "utf8");
    gateway = gateway
      .replace("%REQ(X-ENVOY-ORIGINAL-PATH?:PATH)%", "[path-redacted]")
      .replaceAll("%REQ(REFERER)%", "[referer-redacted]");
    if (gateway.includes("%REQ(X-ENVOY-ORIGINAL-PATH?:PATH)%"))
      throw new Error("Gateway path logging patch failed");
    await writeFile(gatewayFile, gateway);
    await mkdir(path.join(target, "volumes/storage"), { recursive: true });
    await mkdir(path.join(target, "volumes/snippets"), { recursive: true });
    await normalizeVolumeModes(path.join(target, "volumes"));
    // Created after the walk: Postgres sets up its own data directory.
    await mkdir(path.join(target, "volumes/db/data"), { recursive: true });
    const secret = randomBytes(48).toString("base64url");
    const password = randomBytes(32).toString("hex");
    const values = {
      ...parseEnv(
        await readFile(path.join(here, "vendor/.env.example"), "utf8"),
      ),
      COMPOSE_FILE: "compose.json",
      COMPOSE_PROJECT_NAME: project,
      POSTGRES_PASSWORD: password,
      JWT_SECRET: secret,
      ANON_KEY: token("anon", secret),
      SERVICE_ROLE_KEY: token("service_role", secret),
      JWT_KEYS: "",
      JWT_JWKS: "",
      SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_SECRET_KEY: "",
      ANON_KEY_ASYMMETRIC: "",
      SERVICE_ROLE_KEY_ASYMMETRIC: "",
      DASHBOARD_USERNAME: "xy-admin",
      DASHBOARD_PASSWORD: randomBytes(32).toString("base64url"),
      SECRET_KEY_BASE: randomBytes(48).toString("base64"),
      REALTIME_DB_ENC_KEY: randomBytes(8).toString("hex"),
      VAULT_ENC_KEY: randomBytes(16).toString("hex"),
      PG_META_CRYPTO_KEY: randomBytes(32).toString("hex"),
      LOGFLARE_PUBLIC_ACCESS_TOKEN: randomBytes(32).toString("hex"),
      LOGFLARE_PRIVATE_ACCESS_TOKEN: randomBytes(32).toString("hex"),
      S3_PROTOCOL_ACCESS_KEY_ID: randomBytes(16).toString("hex"),
      S3_PROTOCOL_ACCESS_KEY_SECRET: randomBytes(32).toString("hex"),
      MINIO_ROOT_PASSWORD: randomBytes(32).toString("hex"),
      SUPABASE_PUBLIC_URL: supabase,
      API_EXTERNAL_URL: `${supabase}/auth/v1`,
      SITE_URL: web,
      ADDITIONAL_REDIRECT_URLS: `${web}/auth/callback`,
      DISABLE_SIGNUP: "true",
      ENABLE_ANONYMOUS_USERS: "false",
      ENABLE_EMAIL_SIGNUP: "true",
      ENABLE_EMAIL_AUTOCONFIRM: "true",
      ENABLE_PHONE_SIGNUP: "false",
      ENABLE_PHONE_AUTOCONFIRM: "false",
      SMTP_HOST: "",
      SMTP_USER: "",
      SMTP_PASS: "",
      SMTP_ADMIN_EMAIL: "",
      SMTP_SENDER_NAME: "GGUU AI IMAGE",
      OPENAI_API_KEY: "",
      FUNCTIONS_VERIFY_JWT: "true",
      PGRST_DB_SCHEMAS: "public",
      POOLER_TENANT_ID: project,
      STORAGE_TENANT_ID: project,
      POSTGRES_HOST: "db",
      POSTGRES_DB: "postgres",
      POSTGRES_PORT: "5432",
      STUDIO_DEFAULT_ORGANIZATION: "GGUU",
      STUDIO_DEFAULT_PROJECT: "XY-IMAGE",
      ...(options.s3 ? settingsEnv(options.s3) : {}),
    };
    const appEnv = {
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      LOOMIC_SERVER_PORT: "3101",
      LOOMIC_WEB_ORIGIN: web,
      LOOMIC_TRUST_PROXY: "true",
      LOOMIC_AGENT_BACKEND_MODE: "state",
      SUPABASE_URL: supabase,
      SUPABASE_INTERNAL_URL: "http://api-gw:8000",
      SUPABASE_JWT_ISSUER: `${supabase}/auth/v1`,
      SUPABASE_ANON_KEY: values.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY,
      SUPABASE_JWT_SECRET: secret,
      SUPABASE_DB_URL: `postgresql://postgres:${password}@db:5432/postgres`,
      LOOMIC_SECRET_KEY: randomBytes(32).toString("base64"),
      SSO_EMAIL_DOMAIN: options.ssoDomain,
      XY2API_BASE_URL: xy2api,
      XY2API_WEB_URL: xy2api,
      LOOMIC_CHAT_PROVIDER_ALLOW_HTTP: "false",
      LOOMIC_CHAT_PROVIDER_ALLOWED_HOSTS: "",
      // No per-user image limits (0) and a worker that handles many jobs at
      // once (第 57 条); a site that wants limits sets them here.
      WORKER_IMAGE_CONCURRENCY: "32",
      WORKER_POLL_INTERVAL_MS: "2000",
      WORKER_MAX_BATCH_SIZE: "10",
      LOOMIC_MAX_CONCURRENT_JOBS: "0",
      LOOMIC_MAX_PENDING_IMAGE_JOBS: "0",
      LOOMIC_MAX_IMAGES_PER_RUN: "6",
      LOOMIC_SKILLS_ROOT: "/opt/loomic/skills",
      // Single domain: the edge asks /api/media/authorize before serving a
      // project-assets image (FINDINGS S2). Separate origins cannot share
      // the cookie, so their images stay public.
      LOOMIC_MEDIA_ACCESS: mode === "single" ? "cookie" : "open",
      // Shown on 管理 › 存储与告警; the disk monitor reads it.
      LOOMIC_OBJECT_STORAGE: objectStorage,
    };
    base.name = project;
    for (const service of Object.values(base.services)) {
      service.container_name = undefined;
      service.logging = {
        driver: "json-file",
        options: { "max-size": "10m", "max-file": "3" },
      };
    }
    // Official Envoy routing uses this hostname for DNS and tenant selection.
    // Preserve it as a network alias after removing global container names.
    const realtime = base.services.realtime;
    realtime.networks ??= {};
    realtime.networks.default ??= {};
    realtime.networks.default.aliases = [
      ...new Set([
        ...(realtime.networks.default.aliases ?? []),
        "realtime-dev.supabase-realtime",
      ]),
    ];
    base.services["api-gw"].ports = [`127.0.0.1:${ports.gateway}:8000`];
    base.services.supavisor.ports = [];
    base.services.supavisor.profiles = ["pooler"];
    base.services.auth.environment.GOTRUE_EXTERNAL_GOOGLE_ENABLED = "false";
    base.services.auth.environment.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED =
      "false";
    base.services.auth.environment.GOTRUE_DISABLE_SIGNUP = "true";
    base.services.rest.environment.PGRST_DB_SCHEMAS = "public";
    if (objectStorage === "s3")
      base.services.storage.environment = storageEnvironment(
        base.services.storage.environment,
        "s3",
      );
    // Memory ceilings (FINDINGS O3): the host is shared, so a runaway
    // process is stopped by its own limit instead of pushing everything
    // into swap. Several times what each used in production on 2026-10-11
    // (API 145 MiB, worker 115 MiB, storage 175 MiB, imgproxy 20 MiB,
    // studio 195 MiB). The database has none: the kernel would kill it
    // rather than slow it down. Node's heap is capped below the limit so it
    // collects garbage before the cgroup kills it.
    const memory = {
      storage: "1g",
      imgproxy: "1g",
      studio: "512m",
      realtime: "512m",
    };
    for (const [service, limit] of Object.entries(memory))
      if (base.services[service]) base.services[service].mem_limit = limit;
    const app = {
      image: `${project}-backend:local`,
      build: { context: repository, dockerfile: "apps/server/Dockerfile" },
      restart: "unless-stopped",
      init: true,
      env_file: ["./server.env"],
      read_only: true,
      tmpfs: ["/tmp:size=256m,mode=1777"],
      cap_drop: ["ALL"],
      security_opt: ["no-new-privileges:true"],
      stop_grace_period: "720s",
      depends_on: {
        db: { condition: "service_healthy" },
        auth: { condition: "service_healthy" },
        rest: { condition: "service_started" },
        storage: { condition: "service_healthy" },
        "api-gw": { condition: "service_healthy" },
      },
      logging: {
        driver: "json-file",
        options: { "max-size": "10m", "max-file": "5" },
      },
    };
    base.services["xy-api"] = {
      ...app,
      profiles: ["app"],
      ports: [`127.0.0.1:${ports.api}:3101`],
      environment: {
        SERVICE_MODE: "api",
        NODE_OPTIONS: "--max-old-space-size=768",
      },
      mem_limit: "1g",
      deploy: { replicas: 1 },
      healthcheck: {
        test: [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3101/api/ready',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ],
        interval: "30s",
        timeout: "6s",
        retries: 3,
        start_period: "30s",
      },
    };
    base.services["xy-worker"] = {
      ...app,
      profiles: ["app"],
      environment: {
        SERVICE_MODE: "worker",
        WORKER_HEARTBEAT_FILE: "/tmp/xy-worker-heartbeat",
        // sharp decodes 4K pictures outside the JS heap; leave it room. Up
        // to WORKER_IMAGE_CONCURRENCY pictures can finish together.
        NODE_OPTIONS: "--max-old-space-size=2048",
      },
      mem_limit: "3g",
      healthcheck: {
        test: [
          "CMD",
          "node",
          "-e",
          "const fs=require('fs');try{const s=JSON.parse(fs.readFileSync('/tmp/xy-worker-heartbeat','utf8'));process.exit(Date.now()-s.at<60000?0:1)}catch{process.exit(1)}",
        ],
        interval: "30s",
        timeout: "5s",
        retries: 3,
        start_period: "30s",
      },
    };
    base.services["xy-migrate"] = {
      ...app,
      profiles: ["tools"],
      restart: "no",
      read_only: true,
      environment: {},
      command: [
        "node",
        "--import",
        "tsx",
        "scripts/selfhost-migrate.ts",
        "apply",
      ],
    };
    base.services["xy-migrate"].healthcheck = undefined;
    await writeFile(path.join(target, ".env"), envText(values), {
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(path.join(target, "server.env"), envText(appEnv), {
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(
      path.join(target, "web.env"),
      envText({
        NEXT_PUBLIC_SUPABASE_URL: supabase,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: values.ANON_KEY,
        NEXT_PUBLIC_SERVER_BASE_URL: api,
        NEXT_PUBLIC_XY2API_WEB_URL: xy2api,
      }),
      { mode: 0o600, flag: "wx" },
    );
    await writeFile(
      path.join(target, "compose.json"),
      `${JSON.stringify(base, null, 2)}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      path.join(target, "deployment.json"),
      `${JSON.stringify(
        {
          project,
          repository,
          upstreamCommit: upstream.commit,
          createdAt: new Date().toISOString(),
          mode,
          web,
          api,
          supabase,
          webRoot,
          cdn: options.cdn ?? null,
          ports,
          xy2api,
          objectStorage: {
            backend: objectStorage,
            bucket: options.s3?.bucket ?? null,
            endpointHost: options.s3 ? new URL(options.s3.endpoint).host : null,
            switchedAt: null,
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    const files = [
      ".env",
      "server.env",
      "web.env",
      "compose.json",
      "nginx.conf",
      "deployment.json",
    ];
    if (mode === "single") {
      const configs = await singleDomainConfigs({
        host: new URL(web).hostname,
        webRoot,
        realIp,
        ports,
      });
      await writeFile(path.join(target, "nginx.conf"), configs.nginx, {
        mode: 0o600,
      });
      await writeFile(path.join(target, "Caddyfile"), configs.caddy, {
        mode: 0o600,
      });
      files.push("Caddyfile");
    } else {
      const nginx = withPorts(
        await readFile(path.join(here, "nginx.conf.template"), "utf8"),
        ports,
      )
        .replaceAll("__API_HOST__", new URL(api).hostname)
        .replaceAll("__SUPABASE_HOST__", new URL(supabase).hostname)
        .replace("# __REAL_IP__", realIp);
      await writeFile(path.join(target, "nginx.conf"), nginx, { mode: 0o600 });
    }
    return { directory: target, mode, files };
  } catch (error) {
    // Keep partial output for inspection. Never delete a deployment or silently rotate its keys.
    throw new Error(
      "Preparation failed; partial directory retained. Inspect it before choosing a new destination.",
      { cause: error },
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { values } = parseArgs({
      options: {
        dir: { type: "string" },
        origin: { type: "string" },
        "web-root": { type: "string" },
        "web-origin": { type: "string" },
        "api-origin": { type: "string" },
        "supabase-origin": { type: "string" },
        "sso-domain": { type: "string" },
        project: { type: "string" },
        cdn: { type: "string" },
        "api-port": { type: "string" },
        "gateway-port": { type: "string" },
        "xy2api-url": { type: "string" },
        "object-storage": { type: "string" },
        "s3-credentials": { type: "string" },
      },
    });
    let s3;
    if (values["s3-credentials"]) {
      const file = values["s3-credentials"];
      if ((await stat(file)).mode & 0o077)
        throw new Error("The S3 credentials file must be chmod 600");
      s3 = parseS3Settings(await readFile(file, "utf8"));
    }
    // Origins are checked by publicOrigins: --origin, or all three.
    for (const k of ["dir", "sso-domain"])
      if (!values[k]) throw new Error(`Missing --${k}`);
    console.log(
      JSON.stringify(
        await prepare({
          dir: values.dir,
          origin: values.origin,
          webRoot: values["web-root"],
          webOrigin: values["web-origin"],
          apiOrigin: values["api-origin"],
          supabaseOrigin: values["supabase-origin"],
          ssoDomain: values["sso-domain"],
          project: values.project,
          cdn: values.cdn,
          apiPort: values["api-port"],
          gatewayPort: values["gateway-port"],
          xy2apiUrl: values["xy2api-url"],
          objectStorage: values["object-storage"],
          s3,
        }),
      ),
    );
  } catch (error) {
    console.error(`[selfhost] ${error.message}`);
    process.exitCode = 1;
  }
}
