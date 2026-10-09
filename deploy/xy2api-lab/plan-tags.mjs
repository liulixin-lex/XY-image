#!/usr/bin/env node
// Picks the xy2api image tags the contract workflow records:
// newest verified version + "latest" + an optional extra tag.
//
//   EXTRA_TAG=0.2.6 node deploy/xy2api-lab/plan-tags.mjs
//
// Reads XY2API_VERIFIED_VERSIONS from compat.ts so the list has one owner.
// Prints the JSON array; also writes `tags=<json>` to $GITHUB_OUTPUT when set.

import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const compat = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/server/src/features/xy2api/compat.ts",
);
const list = /XY2API_VERIFIED_VERSIONS = \[([^\]]*)\]/.exec(
  readFileSync(compat, "utf8"),
)?.[1];
if (!list) {
  console.error(
    `[xy2api-plan] XY2API_VERIFIED_VERSIONS not found in ${compat}`,
  );
  process.exit(1);
}

const parse = (v) =>
  v
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .slice(0, 3)
    .map((n) => Number.parseInt(n, 10) || 0);
const cmp = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

const verified = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort(cmp);
const tags = [
  ...new Set(
    [verified.at(-1), "latest", process.env.EXTRA_TAG?.trim()].filter(Boolean),
  ),
];
console.error(
  `[xy2api-plan] verified=${verified.join(",")} tags=${tags.join(",")}`,
);
console.log(JSON.stringify(tags));
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `tags=${JSON.stringify(tags)}\n`);
