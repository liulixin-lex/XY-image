import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { listFiles, planPublish } from "./publish-web.mjs";
import { createTestDirectory } from "./test-sandbox.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);

test("keeps the last releases' chunks and replaces everything else", () => {
  const plan = planPublish(
    ["index.html", "studio.html", "_next/static/chunks/c.js"],
    [
      "index.html",
      "old-page.html",
      "_next/static/chunks/a.js",
      "_next/static/chunks/b.js",
      "_next/static/chunks/c.js",
    ],
    [["_next/static/chunks/b.js"], ["_next/static/chunks/a.js"]],
    2,
  );
  assert.deepEqual(plan.remove.sort(), [
    "_next/static/chunks/a.js",
    "old-page.html",
  ]);
  assert.equal(plan.keptOldChunks, 1);
});

test("publishes, precompresses and survives the next release", async () => {
  const dir = await createTestDirectory("publish-web-");
  try {
    const out = path.join(dir, "out");
    const root = path.join(dir, "www", "site");
    const build = async (chunk) => {
      await rm(out, { recursive: true, force: true });
      await mkdir(path.join(out, "_next/static/chunks"), { recursive: true });
      await writeFile(path.join(out, "index.html"), `<html>${"x".repeat(4000)}${chunk}</html>`);
      await writeFile(path.join(out, "404.html"), "<html>404</html>");
      await writeFile(path.join(out, `_next/static/chunks/${chunk}.js`), `console.log(${JSON.stringify("y".repeat(3000))})`);
    };
    const publish = () =>
      run(process.execPath, [path.join(here, "publish-web.mjs"), "--from", out, "--to", root, "--keep", "2"]);
    await build("one");
    await publish();
    let files = await listFiles(root);
    assert.ok(files.includes("index.html.br") && files.includes("index.html.gz"));
    assert.ok(files.includes("_next/static/chunks/one.js.br"));
    assert.ok(!files.includes("404.html.br"), "small files stay uncompressed");
    await build("two");
    await publish();
    files = await listFiles(root);
    // A page still open from release one can load its chunk.
    assert.ok(files.includes("_next/static/chunks/one.js"));
    assert.ok(files.includes("_next/static/chunks/two.js"));
    assert.match(await readFile(path.join(root, "index.html"), "utf8"), /two<\/html>$/);
    await build("three");
    await publish();
    files = await listFiles(root);
    // --keep 2: release one's chunk is gone, two's stays.
    assert.ok(!files.includes("_next/static/chunks/one.js"));
    assert.ok(files.includes("_next/static/chunks/two.js"));
    assert.equal((await readdir(`${root}.releases`)).length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
