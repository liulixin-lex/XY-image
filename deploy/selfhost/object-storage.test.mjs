import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parseEnv } from "node:util";
import vm from "node:vm";
import {
  copierScript,
  parseS3Settings,
  settingsEnv,
  storageBackend,
  storageEnvironment,
  upsertEnv,
} from "./object-storage.mjs";
import { prepare } from "./prepare.mjs";
import { createTestDirectory } from "./test-sandbox.mjs";

const credentials = [
  "S3_ENDPOINT=https://0123abcd.r2.cloudflarestorage.com",
  "S3_BUCKET=xy-image-objects",
  "S3_REGION=auto",
  "S3_ACCESS_KEY_ID=AKIDEXAMPLE",
  "S3_SECRET_ACCESS_KEY=not-a-real-secret",
].join("\n");

test("bucket settings are complete, https and never echoed in errors", () => {
  const settings = parseS3Settings(credentials);
  assert.deepEqual(settings, {
    endpoint: "https://0123abcd.r2.cloudflarestorage.com",
    bucket: "xy-image-objects",
    region: "auto",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "not-a-real-secret",
  });
  // Region defaults to auto (R2).
  assert.equal(
    parseS3Settings(credentials.replace("S3_REGION=auto\n", "")).region,
    "auto",
  );
  for (const [text, message] of [
    [
      credentials.replace(/S3_SECRET_ACCESS_KEY=.*/, ""),
      /Missing S3_SECRET_ACCESS_KEY/,
    ],
    [credentials.replace("https://", "http://"), /https origin/],
    [credentials.replace(".com", ".com/bucket"), /https origin/],
    [credentials.replace("xy-image-objects", "Bad_Bucket"), /valid bucket/],
    [
      credentials.replace("not-a-real-secret", 'not-a-real"secret'),
      /spaces or quotes/,
    ],
  ]) {
    assert.throws(() => parseS3Settings(text), message);
    try {
      parseS3Settings(text);
    } catch (error) {
      assert.ok(!error.message.includes("not-a-real-secret"));
      assert.ok(!error.message.includes("AKIDEXAMPLE"));
    }
  }
  // A lab store on plain http only when asked for.
  assert.equal(
    parseS3Settings(
      credentials.replace(
        "https://0123abcd.r2.cloudflarestorage.com",
        "http://xy-lab-s3:9090",
      ),
      { allowHttp: true },
    ).endpoint,
    "http://xy-lab-s3:9090",
  );
  // A switched deployment reads them back from its .env.
  const env = upsertEnv("", settingsEnv(settings));
  assert.deepEqual(parseS3Settings(env, { prefix: "XY_" }), settings);
});

test("storage switches to the bucket through .env references and back again", () => {
  const original = {
    STORAGE_BACKEND: "file",
    GLOBAL_S3_BUCKET: "${GLOBAL_S3_BUCKET}",
    FILE_STORAGE_BACKEND_PATH: "/var/lib/storage",
    ENABLE_IMAGE_TRANSFORMATION: "true",
    TENANT_ID: "${STORAGE_TENANT_ID}",
  };
  const s3 = storageEnvironment(original, "s3");
  assert.equal(s3.STORAGE_BACKEND, "s3");
  assert.equal(s3.GLOBAL_S3_BUCKET, "${XY_S3_BUCKET}");
  assert.equal(s3.AWS_SECRET_ACCESS_KEY, "${XY_S3_SECRET_ACCESS_KEY}");
  assert.equal(s3.GLOBAL_S3_FORCE_PATH_STYLE, "true");
  assert.equal(s3.STORAGE_S3_REQUEST_CHECKSUM_CALCULATION, "WHEN_REQUIRED");
  assert.equal(s3.ENABLE_IMAGE_TRANSFORMATION, "false");
  // The local folder stays mounted and configured: copies back need it.
  assert.equal(s3.FILE_STORAGE_BACKEND_PATH, "/var/lib/storage");
  assert.equal(
    storageBackend({ services: { storage: { environment: s3 } } }),
    "s3",
  );
  assert.deepEqual(storageEnvironment(s3, "local"), original);
  assert.equal(
    storageBackend({ services: { storage: { environment: original } } }),
    "local",
  );
  assert.throws(() => storageEnvironment(original, "minio"), /s3 or local/);
});

test("env updates replace keys in place and keep everything else", () => {
  const text = "# comment\nA='1'\nLOOMIC_OBJECT_STORAGE='local'\nB='2'\n";
  assert.equal(
    upsertEnv(text, { LOOMIC_OBJECT_STORAGE: "s3", C: "3" }),
    "# comment\nA='1'\nLOOMIC_OBJECT_STORAGE='s3'\nB='2'\nC='3'\n",
  );
  assert.throws(
    () => upsertEnv(text, { X: "a'b" }),
    /Invalid environment value for X/,
  );
});

test("the copier program compiles on its own and carries no settings", () => {
  const script = copierScript();
  assert.doesNotThrow(() => new vm.Script(script));
  // Keys arrive on stdin; the program text is the same for every bucket.
  assert.ok(!/AKID|r2\.cloudflarestorage/.test(script));
  assert.ok(script.includes("storage.objects"));
});

test("prepare --object-storage s3 starts a deployment on the bucket", async () => {
  const root = await createTestDirectory("prepare-s3-");
  try {
    const dir = path.join(root, "deployment");
    const s3 = parseS3Settings(credentials);
    await prepare({
      dir,
      origin: "https://image.example.com",
      ssoDomain: "sso.example.com",
      objectStorage: "s3",
      s3,
    });
    const env = parseEnv(await readFile(path.join(dir, ".env"), "utf8"));
    const server = parseEnv(
      await readFile(path.join(dir, "server.env"), "utf8"),
    );
    const compose = JSON.parse(
      await readFile(path.join(dir, "compose.json"), "utf8"),
    );
    const deployment = JSON.parse(
      await readFile(path.join(dir, "deployment.json"), "utf8"),
    );
    assert.equal(env.XY_S3_BUCKET, "xy-image-objects");
    assert.equal(env.XY_S3_SECRET_ACCESS_KEY, "not-a-real-secret");
    assert.equal(server.LOOMIC_OBJECT_STORAGE, "s3");
    assert.equal(compose.services.storage.environment.STORAGE_BACKEND, "s3");
    // compose.json references the key; only .env (600) holds it.
    assert.ok(!JSON.stringify(compose).includes("not-a-real-secret"));
    assert.ok(!JSON.stringify(deployment).includes("not-a-real-secret"));
    assert.deepEqual(deployment.objectStorage, {
      backend: "s3",
      bucket: "xy-image-objects",
      endpointHost: "0123abcd.r2.cloudflarestorage.com",
      switchedAt: null,
    });

    const plain = path.join(root, "plain");
    await prepare({
      dir: plain,
      origin: "https://image.example.com",
      ssoDomain: "sso.example.com",
    });
    const local = parseEnv(
      await readFile(path.join(plain, "server.env"), "utf8"),
    );
    assert.equal(local.LOOMIC_OBJECT_STORAGE, "local");
    const plainCompose = JSON.parse(
      await readFile(path.join(plain, "compose.json"), "utf8"),
    );
    assert.equal(
      plainCompose.services.storage.environment.STORAGE_BACKEND,
      "file",
    );
    assert.ok(
      !(
        "XY_S3_BUCKET" in
        parseEnv(await readFile(path.join(plain, ".env"), "utf8"))
      ),
    );

    await assert.rejects(
      prepare({
        dir: path.join(root, "x"),
        origin: "https://image.example.com",
        ssoDomain: "sso.example.com",
        objectStorage: "s3",
      }),
      /needs --s3-credentials/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
