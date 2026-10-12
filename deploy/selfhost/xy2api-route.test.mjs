import assert from "node:assert/strict";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createTestDirectory } from "./test-sandbox.mjs";
import {
  ROUTE_SERVICE,
  disableRoute,
  enableRoute,
  parsePrivateAddress,
  publicHostOf,
  renderRouteConfig,
  routeServers,
} from "./xy2api-route.mjs";

// Shape of HAProxy 3.2's stats CSV (columns cut down; the parser reads the
// header), as served by the route on ovh 2026-10-12.
const csv = (privateStatus, publicStatus = "UP") =>
  [
    "# pxname,svname,qcur,status,weight",
    "xy2api_in,FRONTEND,,OPEN,",
    `main_site,private,0,${privateStatus},1`,
    `main_site,public,0,${publicStatus},1`,
    "main_site,BACKEND,0,UP,1",
    "stats,FRONTEND,,OPEN,",
  ].join("\n");

test("renders a passthrough route: the private link first, Cloudflare as backup, minutes-long calls allowed", () => {
  const config = renderRouteConfig({ privateAddress: "10.77.0.1:443", publicHost: "gguuai.com" });
  assert.match(config, /^\s*mode tcp$/m);
  assert.match(config, /^\s*server private 10\.77\.0\.1:443 check .*on-error mark-down$/m);
  assert.match(config, /^\s*server public gguuai\.com:443 backup check .*resolvers public .*init-addr none$/m);
  // Long image calls: no idle cut before the calls' own 600 s limit.
  assert.match(config, /^\s*timeout server 15m$/m);
  assert.match(config, /^\s*timeout client 15m$/m);
  // A failed connection is retried once, on the backup.
  assert.match(config, /^\s*retries 1$/m);
  assert.match(config, /^\s*option redispatch 1$/m);
  // The backup is resolved through public DNS, not the network alias.
  assert.match(config, /^\s*nameserver cloudflare 1\.1\.1\.1:53$/m);
  assert.doesNotMatch(config, /ssl|crt /);
});

test("rejects addresses and main sites the alias cannot stand in for", () => {
  assert.deepEqual(parsePrivateAddress("10.77.0.1:443"), { host: "10.77.0.1", port: 443 });
  for (const bad of ["10.77.0.1", "10.77.0.1:0", "10.77.0.1:70000", "a b:443", "x;y:443", ""])
    assert.throws(() => parsePrivateAddress(bad), /Invalid --private/);
  assert.equal(publicHostOf("https://gguuai.com"), "gguuai.com");
  for (const bad of ["http://gguuai.com", "https://gguuai.com:8443", "https://gguuai.com/api"])
    assert.throws(() => publicHostOf(bad), /https origin on port 443/);
});

test("enable adds the route to an existing deployment without touching the app; disable takes it out", async () => {
  const dir = await createTestDirectory("xy2api-route-");
  try {
    const app = { image: "xy-image-prod-backend:local", env_file: ["./server.env"] };
    const compose = { name: "xy-image-prod", services: { db: { image: "postgres" }, "xy-api": app, "xy-worker": app } };
    await writeFile(path.join(dir, "compose.json"), JSON.stringify(compose), { mode: 0o600 });
    await writeFile(path.join(dir, "deployment.json"), JSON.stringify({ project: "xy-image-prod", xy2api: "https://gguuai.com" }), { mode: 0o600 });

    const result = await enableRoute({ dir, privateAddress: "10.77.0.1:443", statsPort: 18404 });
    assert.equal(result.statsUrl, "http://127.0.0.1:18404/stats;csv");
    const enabled = JSON.parse(await readFile(path.join(dir, "compose.json"), "utf8"));
    const route = enabled.services[ROUTE_SERVICE];
    assert.deepEqual(route.networks, { default: { aliases: ["gguuai.com"] } });
    assert.deepEqual(route.ports, ["127.0.0.1:18404:8404"]);
    assert.deepEqual(route.profiles, ["app"]);
    assert.equal(route.read_only, true);
    assert.deepEqual(route.cap_drop, ["ALL"]);
    // The API and worker keep calling https://gguuai.com unchanged.
    assert.deepEqual(enabled.services["xy-api"], app);
    assert.deepEqual(enabled.services["xy-worker"], app);
    const config = path.join(dir, "xy2api-route.cfg");
    assert.match(await readFile(config, "utf8"), /server private 10\.77\.0\.1:443/);
    assert.equal((await stat(config)).mode & 0o777, 0o644);
    assert.equal((await stat(path.join(dir, "compose.json"))).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, "deployment.json"), "utf8")).xy2apiRoute, {
      private: "10.77.0.1:443",
      statsPort: 18404,
      publicHost: "gguuai.com",
    });

    // Enabling again rewrites in place.
    await enableRoute({ dir, privateAddress: "10.77.0.5:443", statsPort: 18405 });
    const again = JSON.parse(await readFile(path.join(dir, "compose.json"), "utf8"));
    assert.deepEqual(again.services[ROUTE_SERVICE].ports, ["127.0.0.1:18405:8404"]);
    assert.equal(Object.keys(again.services).filter((name) => name === ROUTE_SERVICE).length, 1);

    await disableRoute({ dir });
    const disabled = JSON.parse(await readFile(path.join(dir, "compose.json"), "utf8"));
    assert.deepEqual(disabled, compose);
    assert.equal(JSON.parse(await readFile(path.join(dir, "deployment.json"), "utf8")).xy2apiRoute, undefined);

    await assert.rejects(enableRoute({ dir, privateAddress: "10.77.0.1:443", statsPort: 80 }), /Invalid --stats-port/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reads which way the route goes from HAProxy's stats", () => {
  assert.deepEqual([...routeServers(csv("UP"))], [["private", "UP"], ["public", "UP"]]);
  assert.equal(routeServers(csv("DOWN")).get("private"), "DOWN");
  assert.equal(routeServers("<html>not stats</html>"), null);
});
