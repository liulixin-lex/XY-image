import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { normalizeVolumeModes, prepare } from "./prepare.mjs";
import { createTestDirectory } from "./test-sandbox.mjs";
const repository = fileURLToPath(new URL("../../", import.meta.url));
const options = {
  webOrigin: "https://image.example.com",
  apiOrigin: "https://api.image.example.com",
  supabaseOrigin: "https://db.image.example.com",
  ssoDomain: "sso.example.com",
};
test("offline preparation creates isolated credentials and a closed default network", async () => {
  const root = await createTestDirectory("prepare-test-");
  try {
    const dir = path.join(root, "deployment");
    const result = await prepare({ ...options, dir });
    assert.equal(result.directory, dir);
    const env = parseEnv(await readFile(path.join(dir, ".env"), "utf8"));
    const server = parseEnv(
      await readFile(path.join(dir, "server.env"), "utf8"),
    );
    const browser = parseEnv(await readFile(path.join(dir, "web.env"), "utf8"));
    for (const file of [".env", "server.env", "web.env"])
      assert.equal((await stat(path.join(dir, file))).mode & 0o777, 0o600);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    // Containers read the init scripts as their own users (Postgres: uid 100).
    for (const file of [
      "volumes/db/webhooks.sql",
      "volumes/db/roles.sql",
      "volumes/api/envoy/envoy.yaml",
    ])
      assert.equal(
        (await stat(path.join(dir, file))).mode & 0o777,
        0o644,
        file,
      );
    assert.equal(
      (await stat(path.join(dir, "volumes/db"))).mode & 0o777,
      0o755,
    );
    assert.equal(env.DISABLE_SIGNUP, "true");
    assert.equal(env.ENABLE_ANONYMOUS_USERS, "false");
    assert.equal(env.ENABLE_EMAIL_SIGNUP, "true"); // Admin magiclink verification still required.
    assert.equal(env.PGRST_DB_SCHEMAS, "public");
    assert.equal(server.SUPABASE_INTERNAL_URL, "http://api-gw:8000");
    assert.equal(
      server.SUPABASE_JWT_ISSUER,
      `${options.supabaseOrigin}/auth/v1`,
    );
    assert.equal(browser.NEXT_PUBLIC_SUPABASE_URL, server.SUPABASE_URL);
    assert.equal(Buffer.from(server.LOOMIC_SECRET_KEY, "base64").length, 32);
    assert.ok(
      !JSON.stringify(browser).includes(server.SUPABASE_SERVICE_ROLE_KEY),
    );
    for (const [key, role] of [
      ["ANON_KEY", "anon"],
      ["SERVICE_ROLE_KEY", "service_role"],
    ]) {
      const parts = env[key].split(".");
      assert.equal(JSON.parse(Buffer.from(parts[1], "base64url")).role, role);
      assert.equal(
        parts[2],
        createHmac("sha256", env.JWT_SECRET)
          .update(parts.slice(0, 2).join("."))
          .digest("base64url"),
      );
    }
    const compose = JSON.parse(
      await readFile(path.join(dir, "compose.json"), "utf8"),
    );
    assert.deepEqual(compose.services["api-gw"].ports, [
      "127.0.0.1:18000:8000",
    ]);
    assert.deepEqual(compose.services.supavisor.ports, []);
    assert.deepEqual(compose.services["xy-api"].profiles, ["app"]);
    assert.deepEqual(compose.services["xy-api"].ports, ["127.0.0.1:3101:3101"]);
    assert.equal(server.XY2API_BASE_URL, "https://gguuai.com");
    assert.equal(browser.NEXT_PUBLIC_XY2API_WEB_URL, "https://gguuai.com");
    assert.equal(compose.services["xy-api"].deploy.replicas, 1);
    // FINDINGS O3: memory ceilings on a shared host, none on the database.
    assert.equal(compose.services["xy-api"].mem_limit, "1g");
    assert.equal(compose.services["xy-worker"].mem_limit, "3g");
    assert.match(compose.services["xy-worker"].environment.NODE_OPTIONS, /max-old-space-size=2048/);
    assert.equal(compose.services.storage.mem_limit, "1g");
    assert.equal(compose.services.db.mem_limit, undefined);
    assert.ok(
      compose.services.realtime.networks.default.aliases.includes(
        "realtime-dev.supabase-realtime",
      ),
    );
    const hostnames = new Set(Object.keys(compose.services));
    for (const service of Object.values(compose.services)) {
      for (const network of Object.values(service.networks ?? {})) {
        for (const alias of network?.aliases ?? []) hostnames.add(alias);
      }
    }
    const upstreams = await readFile(
      path.join(dir, "volumes/api/envoy/cds.yaml"),
      "utf8",
    );
    const gatewayHosts = [
      ...upstreams.matchAll(/^[ \t]+address:[ \t]+(\S+)[ \t]*$/gm),
    ];
    assert.ok(gatewayHosts.length >= 7, "Inspect all fixed gateway clusters");
    for (const [, hostname] of gatewayHosts) {
      assert.ok(
        hostnames.has(hostname),
        `Unresolvable gateway upstream: ${hostname}`,
      );
    }

    assert.equal(compose.services["xy-worker"].stop_grace_period, "720s");
    assert.equal(compose.services["xy-api"].read_only, true);
    assert.ok(Object.values(compose.services).every((s) => !s.container_name));
    for (const service of Object.values(compose.services)) {
      for (const volume of service.volumes ?? []) {
        const host =
          typeof volume === "string" ? volume.split(":")[0] : volume.source;
        if (host.startsWith("./")) await stat(path.join(dir, host));
      }
    }
    const gateway = await readFile(
      path.join(dir, "volumes/api/envoy/lds.template.yaml"),
      "utf8",
    );
    assert.ok(gateway.includes("[path-redacted]"));
    assert.ok(!gateway.includes("%REQ(:PATH)%"));
    assert.ok(gateway.includes("[referer-redacted]"));
    const nginx = await readFile(path.join(dir, "nginx.conf"), "utf8");
    assert.ok(!nginx.includes("__REAL_IP__"));
    assert.ok(!nginx.includes("set_real_ip_from"), "No CDN trusted by default");
    const before = await readFile(path.join(dir, "server.env"), "utf8");
    await assert.rejects(prepare({ ...options, dir }));
    assert.equal(await readFile(path.join(dir, "server.env"), "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("invalid origins and repository destinations fail before writing", async () => {
  await assert.rejects(
    prepare({ ...options, dir: path.join(repository, "selfhost-private") }),
    /outside the repository/,
  );
  await assert.rejects(
    prepare({
      ...options,
      dir: path.resolve(repository, "../invalid-selfhost-test"),
      apiOrigin: "http://api.example.com",
    }),
    /HTTPS origin/,
  );
});
test("--cdn cloudflare trusts only Cloudflare edges for the client address", async () => {
  const root = await createTestDirectory("prepare-cdn-test-");
  try {
    const dir = path.join(root, "deployment");
    await prepare({ ...options, dir, cdn: "cloudflare" });
    const nginx = await readFile(path.join(dir, "nginx.conf"), "utf8");
    assert.match(nginx, /^set_real_ip_from 173\.245\.48\.0\/20;$/m);
    assert.match(nginx, /^set_real_ip_from 2606:4700::\/32;$/m);
    assert.match(nginx, /^real_ip_header CF-Connecting-IP;$/m);
    assert.ok(!/set_real_ip_from (0\.0\.0\.0|::)\/0/.test(nginx));
    const deployment = JSON.parse(
      await readFile(path.join(dir, "deployment.json"), "utf8"),
    );
    assert.equal(deployment.cdn, "cloudflare");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  await assert.rejects(
    prepare({
      ...options,
      dir: path.resolve(repository, "../invalid-cdn-test"),
      cdn: "fastly",
    }),
    /Unsupported cdn/,
  );
});

test("volume files are readable by container users whatever the checkout's modes", async () => {
  const root = await createTestDirectory("prepare-modes-");
  try {
    await mkdir(path.join(root, "db"), { mode: 0o700 });
    await writeFile(path.join(root, "db/webhooks.sql"), "select 1;", {
      mode: 0o600,
    });
    await writeFile(path.join(root, "entrypoint.sh"), "#!/bin/sh", {
      mode: 0o700,
    });
    await chmod(root, 0o700);
    await normalizeVolumeModes(root);
    assert.equal((await stat(root)).mode & 0o777, 0o755);
    assert.equal((await stat(path.join(root, "db"))).mode & 0o777, 0o755);
    assert.equal(
      (await stat(path.join(root, "db/webhooks.sql"))).mode & 0o777,
      0o644,
    );
    assert.equal(
      (await stat(path.join(root, "entrypoint.sh"))).mode & 0o777,
      0o755,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("--origin prepares a single-domain deployment: Supabase under /supabase, API under /api", async () => {
  const root = await createTestDirectory("prepare-single-");
  try {
    const dir = path.join(root, "deployment");
    const result = await prepare({
      dir,
      origin: "https://image.example.com",
      webRoot: "/srv/xy-image/site/",
      ssoDomain: "sso.example.com",
    });
    assert.equal(result.mode, "single");
    assert.ok(result.files.includes("Caddyfile"));
    const env = parseEnv(await readFile(path.join(dir, ".env"), "utf8"));
    const server = parseEnv(
      await readFile(path.join(dir, "server.env"), "utf8"),
    );
    const browser = parseEnv(await readFile(path.join(dir, "web.env"), "utf8"));
    // The values the pre-launch server was set up with by hand.
    assert.equal(env.SUPABASE_PUBLIC_URL, "https://image.example.com/supabase");
    assert.equal(
      env.API_EXTERNAL_URL,
      "https://image.example.com/supabase/auth/v1",
    );
    assert.equal(env.SITE_URL, "https://image.example.com");
    assert.equal(
      env.ADDITIONAL_REDIRECT_URLS,
      "https://image.example.com/auth/callback",
    );
    assert.equal(server.SUPABASE_URL, "https://image.example.com/supabase");
    assert.equal(server.SUPABASE_JWT_ISSUER, env.API_EXTERNAL_URL);
    assert.equal(server.LOOMIC_WEB_ORIGIN, "https://image.example.com");
    // FINDINGS S2: images only for workspace members, checked at the edge.
    assert.equal(server.LOOMIC_MEDIA_ACCESS, "cookie");
    assert.equal(browser.NEXT_PUBLIC_SUPABASE_URL, server.SUPABASE_URL);
    assert.equal(
      browser.NEXT_PUBLIC_SERVER_BASE_URL,
      "https://image.example.com",
    );
    for (const file of ["nginx.conf", "Caddyfile"])
      assert.equal((await stat(path.join(dir, file))).mode & 0o777, 0o600);

    const nginx = await readFile(path.join(dir, "nginx.conf"), "utf8");
    assert.ok(!nginx.includes("__"), "Every placeholder is filled");
    assert.match(nginx, /^\s+server_name image\.example\.com;$/m);
    assert.match(nginx, /^\s+root \/srv\/xy-image\/site;$/m);
    assert.match(nginx, /live\/image\.example\.com\/fullchain\.pem/);
    assert.ok(!nginx.includes("set_real_ip_from"), "No CDN trusted by default");
    assert.equal((nginx.match(/^\s*server \{$/gm) ?? []).length, 1);
    assert.match(nginx, /auth_request \/_xy_media_authorize;/);
    assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3101\/api\/media\/authorize;/);

    const caddy = await readFile(path.join(dir, "Caddyfile"), "utf8");
    assert.ok(!caddy.includes("__"));
    assert.match(caddy, /^image\.example\.com \{$/m);
    assert.match(caddy, /root \* \/srv\/xy-image\/site$/m);
    assert.match(caddy, /handle_path \/supabase\/\* \{/);
    assert.match(caddy, /@private_ready path \/api\/ready/);
    assert.match(caddy, /forward_auth 127\.0\.0\.1:3101 \{\n\s+uri \/api\/media\/authorize/);

    const deployment = JSON.parse(
      await readFile(path.join(dir, "deployment.json"), "utf8"),
    );
    assert.equal(deployment.mode, "single");
    assert.equal(deployment.supabase, "https://image.example.com/supabase");
    assert.equal(deployment.webRoot, "/srv/xy-image/site");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a second deployment on the same host gets its own project, ports and main site", async () => {
  const root = await createTestDirectory("prepare-second-");
  try {
    const dir = path.join(root, "deployment");
    await prepare({
      dir,
      origin: "https://image.example.com",
      ssoDomain: "sso.example.com",
      project: "xy-image-prod",
      apiPort: "3201",
      gatewayPort: "18100",
      xy2apiUrl: "https://main.example.com",
    });
    const env = parseEnv(await readFile(path.join(dir, ".env"), "utf8"));
    const server = parseEnv(
      await readFile(path.join(dir, "server.env"), "utf8"),
    );
    const browser = parseEnv(await readFile(path.join(dir, "web.env"), "utf8"));
    assert.equal(env.COMPOSE_PROJECT_NAME, "xy-image-prod");
    // Inside the container the API still listens on 3101.
    assert.equal(server.LOOMIC_SERVER_PORT, "3101");
    assert.equal(server.XY2API_BASE_URL, "https://main.example.com");
    assert.equal(server.XY2API_WEB_URL, "https://main.example.com");
    assert.equal(
      browser.NEXT_PUBLIC_XY2API_WEB_URL,
      "https://main.example.com",
    );
    const compose = JSON.parse(
      await readFile(path.join(dir, "compose.json"), "utf8"),
    );
    assert.equal(compose.name, "xy-image-prod");
    assert.deepEqual(compose.services["api-gw"].ports, [
      "127.0.0.1:18100:8000",
    ]);
    assert.deepEqual(compose.services["xy-api"].ports, ["127.0.0.1:3201:3101"]);
    assert.equal(
      compose.services["xy-api"].image,
      "xy-image-prod-backend:local",
    );
    for (const file of ["nginx.conf", "Caddyfile"]) {
      const text = await readFile(path.join(dir, file), "utf8");
      assert.ok(!text.includes(":3101"), `${file} still points at 3101`);
      assert.ok(!text.includes(":18000"), `${file} still points at 18000`);
      assert.ok(text.includes("127.0.0.1:3201"), file);
      assert.ok(text.includes("127.0.0.1:18100"), file);
    }
    const deployment = JSON.parse(
      await readFile(path.join(dir, "deployment.json"), "utf8"),
    );
    assert.deepEqual(deployment.ports, { api: 3201, gateway: 18100 });
    assert.equal(deployment.xy2api, "https://main.example.com");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const dir = path.resolve(repository, "../invalid-ports-test");
  for (const [extra, message] of [
    [{ apiPort: "80" }, /api-port must be a port/],
    [{ gatewayPort: "70000" }, /gateway-port must be a port/],
    [{ apiPort: "3101.5" }, /api-port must be a port/],
    [{ apiPort: "18000" }, /must differ/],
    [
      { xy2apiUrl: "http://main.example.com" },
      /xy2api-url must be an HTTPS origin/,
    ],
    [
      { xy2apiUrl: "https://main.example.com/api" },
      /xy2api-url must be an HTTPS origin/,
    ],
  ])
    await assert.rejects(prepare({ ...options, dir, ...extra }), message);
});

test("--origin and the three origins are exclusive, and web-root must be a plain absolute path", async () => {
  const dir = path.resolve(repository, "../invalid-single-test");
  await assert.rejects(
    prepare({ ...options, dir, origin: "https://image.example.com" }),
    /either --origin/,
  );
  await assert.rejects(
    prepare({
      dir,
      webOrigin: options.webOrigin,
      ssoDomain: options.ssoDomain,
    }),
    /Give --origin for one domain/,
  );
  await assert.rejects(
    prepare({
      dir,
      origin: "https://image.example.com/app",
      ssoDomain: options.ssoDomain,
    }),
    /origin must be an HTTPS origin/,
  );
  for (const webRoot of ["site", "/srv/../etc", "/srv/xy image", "/srv;x"])
    await assert.rejects(
      prepare({
        dir,
        origin: "https://image.example.com",
        webRoot,
        ssoDomain: options.ssoDomain,
      }),
      /web-root must be an absolute path/,
      webRoot,
    );
});
