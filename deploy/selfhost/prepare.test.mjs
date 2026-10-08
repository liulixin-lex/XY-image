import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { prepare } from "./prepare.mjs";
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
    assert.equal(compose.services["xy-api"].deploy.replicas, 1);
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
