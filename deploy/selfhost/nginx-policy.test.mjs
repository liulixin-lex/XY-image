import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { realIpBlock } from "./prepare.mjs";
import { createTestDirectory } from "./test-sandbox.mjs";

async function unusedLoopbackPort() {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function request(port, method, url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path: url,
      headers: { host: "supabase.test.invalid", ...extraHeaders },
      agent: false,
    });
    outgoing.setTimeout(2_000, () =>
      outgoing.destroy(new Error("Local Nginx request timed out")),
    );
    outgoing.on("error", reject);
    outgoing.on("response", (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    outgoing.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve({ status: response.statusCode, body: "" });
    });
    if (["POST", "PUT", "PATCH"].includes(method))
      outgoing.write('{"password":"synthetic-test-only"}');
    outgoing.end();
  });
}

async function stopChild(child, exited) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const deadline = setTimeout(() => child.kill("SIGKILL"), 3_000);
  try {
    await exited;
  } finally {
    clearTimeout(deadline);
  }
}

test(
  "the production Nginx template permits session use and object reads but blocks shadow-account bypasses, REST, Realtime and Storage writes",
  {
    skip: process.env.XY_NGINX_BINARY
      ? false
      : "Set XY_NGINX_BINARY to run the real local Nginx policy regression",
    timeout: 30_000,
  },
  async () => {
    const root = await createTestDirectory("nginx-policy-");
    const forwarded = [];
    const clientAddresses = [];
    const upstream = http.createServer((incoming, response) => {
      incoming.resume();
      forwarded.push({ method: incoming.method, url: incoming.url });
      clientAddresses.push(incoming.headers["x-forwarded-for"]);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(forwarded.at(-1)));
    });
    upstream.on("upgrade", (incoming, socket) => {
      forwarded.push({ method: incoming.method, url: incoming.url });
      socket.on("error", () => {});
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
      socket.end();
    });
    let child;
    let exited;
    let stderr = "";
    try {
      upstream.listen(0, "127.0.0.1");
      await once(upstream, "listening");
      const upstreamPort = upstream.address().port;
      const nginxPort = await unusedLoopbackPort();
      const original = await readFile(
        new URL("./nginx.conf.template", import.meta.url),
        "utf8",
      );
      // Exercise the real policy unchanged. Only local transport and filesystem
      // configuration are substituted; no replica location/map rules live here.
      const template = original
        .replaceAll("listen 443 ssl;", `listen 127.0.0.1:${nginxPort};`)
        .replaceAll("__API_HOST__", "api.test.invalid")
        .replaceAll("__SUPABASE_HOST__", "supabase.test.invalid")
        // The Cloudflare variant, so its realip block is checked too.
        .replace("# __REAL_IP__", realIpBlock("cloudflare"))
        .replace(/^\s*ssl_certificate(?:_key)?\s+[^;]+;\s*$/gm, "")
        .replaceAll("http://127.0.0.1:3101", `http://127.0.0.1:${upstreamPort}`)
        .replaceAll(
          "http://127.0.0.1:18000",
          `http://127.0.0.1:${upstreamPort}`,
        )
        .replace(/\/var\/log\/nginx\/(xy-[a-z.-]+\.log)/g, (_match, name) =>
          JSON.stringify(path.join(root, name)),
        );
      assert.ok(
        !template.includes("listen 443"),
        "Every production listener must be loopback-only in this test",
      );
      const config = path.join(root, "nginx.conf");
      await writeFile(
        config,
        `daemon off;\nmaster_process off;\npid ${JSON.stringify(path.join(root, "nginx.pid"))};\nerror_log ${JSON.stringify(path.join(root, "startup.log"))} crit;\nevents { worker_connections 64; }\nhttp {\nclient_body_temp_path ${JSON.stringify(path.join(root, "body"))};\nproxy_temp_path ${JSON.stringify(path.join(root, "proxy"))};\nfastcgi_temp_path ${JSON.stringify(path.join(root, "fastcgi"))};\nuwsgi_temp_path ${JSON.stringify(path.join(root, "uwsgi"))};\nscgi_temp_path ${JSON.stringify(path.join(root, "scgi"))};\n${template}\n}\n`,
        { mode: 0o600 },
      );
      child = spawn(
        process.env.XY_NGINX_BINARY,
        ["-p", `${root}/`, "-c", config],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      let spawnError;
      child.on("error", (error) => {
        spawnError = error;
      });
      exited = new Promise((resolve) => child.once("close", resolve));
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (spawnError) throw spawnError;
        assert.equal(
          child.exitCode,
          null,
          `Nginx exited before listening: ${stderr}`,
        );
        try {
          const probe = await request(
            nginxPort,
            "GET",
            "/blocked-startup-probe",
          );
          assert.equal(probe.status, 404);
          ready = true;
          break;
        } catch (error) {
          if (error.code !== "ECONNREFUSED") throw error;
          await delay(20);
        }
      }
      assert.ok(ready, `Nginx did not start: ${stderr}`);

      const blocked = [
        ["PUT", "/auth/v1/user"],
        ["PATCH", "/auth/v1/user"],
        ["POST", "/auth/v1/user"],
        ["DELETE", "/auth/v1/user"],
        ["POST", "/auth/v1/token?grant_type=password"],
        ["POST", "/auth/v1/token?grant_type=pkce"],
        ["POST", "/auth/v1/token"],
        ["GET", "/auth/v1/token?grant_type=refresh_token"],
        ["PUT", "/auth/v1/token?grant_type=refresh_token"],
        ["POST", "/auth/v1/token?grant_type=refresh_token&grant_type=password"],
        ["POST", "/auth/v1/token?grant_type=password&grant_type=refresh_token"],
        [
          "POST",
          "/auth/v1/token?grant_type=refresh_token&grant_type=refresh_token",
        ],
        ["POST", "/auth/v1/token?grant_type=%72efresh_token"],
        ["POST", "/auth/v1/token?grant_type=refresh_token&unexpected=1"],
        ["GET", "/auth/v1/admin/users"],
        ["POST", "/auth/v1/admin/users"],
        ["POST", "/auth/v1/signup"],
        ["POST", "/auth/v1/recover"],
        ["POST", "/auth/v1/magiclink"],
        ["POST", "/auth/v1/invite"],
        ["POST", "/auth/v1/generate_link"],
        ["GET", "/auth/v1/authorize"],
        ["POST", "/auth/v1/otp"],
        ["GET", "/auth/v1/verify"],
        ["GET", "/auth/v1/logout"],
        ["POST", "/auth/v1/logout?scope=invalid"],
        ["POST", "/auth/v1/logout?scope=global&scope=local"],
        ["POST", "/auth/v1/user/"],
        ["POST", "/auth/v1/verify/"],
        ["GET", "/"],
        ["GET", "/pg/"],
        // Browsers never use REST, Realtime or Storage writes/listing.
        ["GET", "/rest/v1/projects?select=id"],
        ["POST", "/rest/v1/rpc/synthetic"],
        ["GET", "/realtime/v1/websocket?vsn=1.0.0"],
        ["GET", "/storage/v1/bucket"],
        ["POST", "/storage/v1/object/project-assets/synthetic.png"],
        ["PUT", "/storage/v1/object/project-assets/synthetic.png"],
        ["DELETE", "/storage/v1/object/project-assets"],
        ["POST", "/storage/v1/object/list/canvases"],
        ["POST", "/storage/v1/object/upload/sign/project-assets/synthetic.png"],
        ["POST", "/storage/v1/object/sign/project-assets/synthetic.png"],
        ["POST", "/storage/v1/object/public/project-assets/synthetic.png"],
        ["GET", "/storage/v1/object/public/canvases/synthetic.png"],
        ["GET", "/storage/v1/object/public/project-assets/"],
        [
          "GET",
          "/storage/v1/object/public/project-assets/%2e%2e/%2e%2e/list/canvases",
        ],
        ["GET", "/storage/v1/object/public/project-assets/..%2F..%2Fbucket"],
        ["GET", "/storage/v1/render/image/public/project-assets/synthetic.png"],
      ];
      for (const [method, url] of blocked) {
        const count = forwarded.length;
        const result = await request(nginxPort, method, url);
        assert.equal(result.status, 404, `${method} ${url} must be rejected`);
        assert.equal(
          forwarded.length,
          count,
          `${method} ${url} must not reach Supabase`,
        );
      }

      const allowed = [
        ["POST", "/auth/v1/verify"],
        ["POST", "/auth/v1/logout"],
        ["POST", "/auth/v1/logout?scope=global"],
        ["POST", "/auth/v1/logout?scope=local"],
        ["POST", "/auth/v1/logout?scope=others"],
        ["GET", "/auth/v1/user"],
        ["POST", "/auth/v1/token?grant_type=refresh_token"],
        ["OPTIONS", "/auth/v1/verify"],
        ["OPTIONS", "/auth/v1/logout"],
        ["OPTIONS", "/auth/v1/user"],
        ["OPTIONS", "/auth/v1/token"],
        ["OPTIONS", "/auth/v1/token?grant_type=refresh_token"],
        ["GET", "/storage/v1/object/public/project-assets/synthetic.png"],
        [
          "GET",
          "/storage/v1/object/public/project-assets/u/1/synthetic.png?download=a.png",
        ],
        [
          "GET",
          "/storage/v1/object/sign/brand-kit-assets/u/logo.png?token=synthetic",
        ],
      ];
      for (const [method, url] of allowed) {
        const count = forwarded.length;
        const result = await request(nginxPort, method, url);
        assert.equal(result.status, 200, `${method} ${url} must remain usable`);
        assert.equal(forwarded.length, count + 1);
        assert.deepEqual(
          JSON.parse(result.body),
          { method, url },
          "Forward method/query without rewriting auth policy",
        );
      }
      const head = await request(
        nginxPort,
        "HEAD",
        "/storage/v1/object/public/project-assets/synthetic.png",
      );
      assert.equal(head.status, 200, "HEAD of a public object remains usable");
      const before = forwarded.length;
      const realtime = await request(
        nginxPort,
        "GET",
        "/realtime/v1/websocket?vsn=1.0.0",
        { upgrade: "websocket", connection: "Upgrade" },
      );
      assert.equal(realtime.status, 404, "Realtime is not public");
      assert.equal(
        forwarded.length,
        before,
        "Realtime upgrades must not reach Supabase",
      );
      const api = await request(nginxPort, "POST", "/api/synthetic", {
        host: "api.test.invalid",
      });
      assert.equal(
        api.status,
        200,
        "The independent application API virtual host remains available",
      );
      await request(nginxPort, "POST", "/api/synthetic", {
        host: "api.test.invalid",
        "cf-connecting-ip": "203.0.113.9",
        "x-forwarded-for": "203.0.113.9",
      });
      assert.equal(
        clientAddresses.at(-1),
        "127.0.0.1",
        "Only CDN edges may name the client; a direct caller cannot",
      );
      assert.equal(
        (
          await request(nginxPort, "GET", "/api/ready", {
            host: "api.test.invalid",
          })
        ).status,
        404,
      );
    } finally {
      if (child && exited) await stopChild(child, exited);
      upstream.closeAllConnections();
      await new Promise((resolve) => upstream.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  },
);
