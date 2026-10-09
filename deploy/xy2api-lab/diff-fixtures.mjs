#!/usr/bin/env node
// Shape diff between two recorded xy2api fixture sets, e.g. the verified
// version vs. what CI just recorded from `latest`:
//
//   node deploy/xy2api-lab/diff-fixtures.mjs <old-dir> <new-dir>
//
// Prints Markdown (fits $GITHUB_STEP_SUMMARY): status changes, scenarios that
// appeared/disappeared, JSON paths added/removed or whose type changed, and
// billing evidence changes. Values are ignored — only the contract shape.
// Differences that only reflect data (an array empty on one side, a field that
// is null on one side) are counted as value-dependent, not as drift.
// Exit code is always 0; the replay suite decides pass/fail.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const [oldDir, newDir] = process.argv.slice(2);
if (!oldDir || !newDir) {
  console.error("usage: diff-fixtures.mjs <old-dir> <new-dir>");
  process.exit(2);
}

const readSet = (dir) =>
  Object.fromEntries(
    readdirSync(dir)
      .filter(
        (f) =>
          f.endsWith(".json") && !["manifest.json", "billing.json"].includes(f),
      )
      .map((f) => [
        basename(f, ".json"),
        JSON.parse(readFileSync(join(dir, f), "utf8")),
      ]),
  );

// Flatten to "path -> type"; arrays collapse to their element shape ([]).
function shape(value, path = "$", out = new Map()) {
  if (Array.isArray(value)) {
    out.set(path, value.length ? "array" : "array(empty)");
    for (const item of value.slice(0, 5)) shape(item, `${path}[]`, out);
  } else if (value && typeof value === "object") {
    out.set(path, "object");
    for (const [k, v] of Object.entries(value)) shape(v, `${path}.${k}`, out);
  } else {
    const type = value === null ? "null" : typeof value;
    const prev = out.get(path);
    out.set(path, prev && prev !== type ? `${prev}|${type}` : type);
  }
  return out;
}

// A path absent on one side only because an ancestor there is null or an
// empty array says nothing about the contract.
function hiddenByValue(shapes, path) {
  for (let i = path.length; i > 0; i--) {
    const ancestor = path.slice(0, i);
    if (ancestor === path || !/[.[]/.test(path[i] ?? "")) continue;
    const type = shapes.get(ancestor);
    if (type === "null" || type === "array(empty)") return true;
    if (type !== undefined) return false;
  }
  return false;
}

const sameModuloNull = (a, b) => {
  const strip = (t) =>
    t
      .split("|")
      .filter((x) => x !== "null")
      .map((x) => x.replace("(empty)", ""))
      .sort()
      .join("|");
  return strip(a) === strip(b) || a === "null" || b === "null";
};

const a = readSet(oldDir);
const b = readSet(newDir);
const version = (dir) => {
  const file = join(dir, "manifest.json");
  return existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8")).version
    : basename(dir);
};
const lines = [
  `### xy2api fixture diff: ${version(oldDir)} → ${version(newDir)}`,
  "",
];
let changes = 0;
let valueOnly = 0;

for (const name of Object.keys(b).filter((n) => !(n in a))) {
  lines.push(`- ➕ new scenario \`${name}\``);
  changes++;
}
for (const name of Object.keys(a).filter((n) => !(n in b))) {
  lines.push(`- ➖ scenario missing in new set \`${name}\``);
  changes++;
}
for (const name of Object.keys(a).filter((n) => n in b)) {
  const ra = a[name].response;
  const rb = b[name].response;
  const notes = [];
  if (ra.status !== rb.status)
    notes.push(`status ${ra.status} → **${rb.status}**`);
  const sa = shape(ra.json ?? ra.text ?? null);
  const sb = shape(rb.json ?? rb.text ?? null);
  for (const [path, type] of sb) {
    if (!sa.has(path)) {
      if (hiddenByValue(sa, path)) valueOnly++;
      else notes.push(`+ \`${path}\` (${type})`);
    } else if (sa.get(path) !== type) {
      if (sameModuloNull(sa.get(path), type)) valueOnly++;
      else notes.push(`~ \`${path}\` ${sa.get(path)} → ${type}`);
    }
  }
  for (const path of sa.keys())
    if (!sb.has(path)) {
      if (hiddenByValue(sb, path)) valueOnly++;
      else notes.push(`- \`${path}\``);
    }
  for (const header of new Set([
    ...Object.keys(ra.headers ?? {}),
    ...Object.keys(rb.headers ?? {}),
  ]))
    if (Boolean(ra.headers?.[header]) !== Boolean(rb.headers?.[header]))
      notes.push(
        `header \`${header}\` ${rb.headers?.[header] ? "added" : "removed"}`,
      );
  if (notes.length) {
    changes += notes.length;
    lines.push(`- \`${name}\``, ...notes.slice(0, 40).map((n) => `  - ${n}`));
    if (notes.length > 40) lines.push(`  - … ${notes.length - 40} more`);
  }
}

const billing = (dir) => {
  const file = join(dir, "billing.json");
  return existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8")).scenarios
    : {};
};
const ba = billing(oldDir);
const bb = billing(newDir);
for (const name of Object.keys(bb))
  if (name in ba && ba[name] !== bb[name]) {
    lines.push(
      `- 💰 billing \`${name}\`: ${ba[name] ? "billed" : "not billed"} → **${bb[name] ? "billed" : "not billed"}**`,
    );
    changes++;
  }

if (!changes) lines.push("No shape, status, header or billing differences.");
if (valueOnly)
  lines.push(
    "",
    `_${valueOnly} value-dependent difference(s) ignored (empty arrays / null fields)._`,
  );
console.log(lines.join("\n"));
