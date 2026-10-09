import { createHash, createHmac, randomBytes } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
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
  const web = origin(options.webOrigin, "web-origin");
  const api = origin(options.apiOrigin, "api-origin");
  const supabase = origin(options.supabaseOrigin, "supabase-origin");
  const realIp = realIpBlock(options.cdn);
  if (new Set([web, api, supabase]).size !== 3)
    throw new Error(
      "Use three distinct public origins with this deployment template",
    );
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
      XY2API_BASE_URL: "https://gguuai.com",
      XY2API_WEB_URL: "https://gguuai.com",
      LOOMIC_CHAT_PROVIDER_ALLOW_HTTP: "false",
      LOOMIC_CHAT_PROVIDER_ALLOWED_HOSTS: "",
      WORKER_IMAGE_CONCURRENCY: "3",
      WORKER_POLL_INTERVAL_MS: "2000",
      WORKER_MAX_BATCH_SIZE: "3",
      LOOMIC_MAX_CONCURRENT_JOBS: "2",
      LOOMIC_MAX_IMAGES_PER_RUN: "6",
      LOOMIC_SKILLS_ROOT: "/opt/loomic/skills",
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
    base.services["api-gw"].ports = ["127.0.0.1:18000:8000"];
    base.services.supavisor.ports = [];
    base.services.supavisor.profiles = ["pooler"];
    base.services.auth.environment.GOTRUE_EXTERNAL_GOOGLE_ENABLED = "false";
    base.services.auth.environment.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED =
      "false";
    base.services.auth.environment.GOTRUE_DISABLE_SIGNUP = "true";
    base.services.rest.environment.PGRST_DB_SCHEMAS = "public";
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
      ports: ["127.0.0.1:3101:3101"],
      environment: { SERVICE_MODE: "api" },
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
      },
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
        NEXT_PUBLIC_XY2API_WEB_URL: "https://gguuai.com",
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
          web,
          api,
          supabase,
          cdn: options.cdn ?? null,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    const nginx = (
      await readFile(path.join(here, "nginx.conf.template"), "utf8")
    )
      .replaceAll("__API_HOST__", new URL(api).hostname)
      .replaceAll("__SUPABASE_HOST__", new URL(supabase).hostname)
      .replace("# __REAL_IP__", realIp);
    await writeFile(path.join(target, "nginx.conf"), nginx, { mode: 0o600 });
    return {
      directory: target,
      files: [
        ".env",
        "server.env",
        "web.env",
        "compose.json",
        "nginx.conf",
        "deployment.json",
      ],
    };
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
        "web-origin": { type: "string" },
        "api-origin": { type: "string" },
        "supabase-origin": { type: "string" },
        "sso-domain": { type: "string" },
        project: { type: "string" },
        cdn: { type: "string" },
      },
    });
    for (const k of [
      "dir",
      "web-origin",
      "api-origin",
      "supabase-origin",
      "sso-domain",
    ])
      if (!values[k]) throw new Error(`Missing --${k}`);
    console.log(
      JSON.stringify(
        await prepare({
          dir: values.dir,
          webOrigin: values["web-origin"],
          apiOrigin: values["api-origin"],
          supabaseOrigin: values["supabase-origin"],
          ssoDomain: values["sso-domain"],
          project: values.project,
          cdn: values.cdn,
        }),
      ),
    );
  } catch (error) {
    console.error(`[selfhost] ${error.message}`);
    process.exitCode = 1;
  }
}
