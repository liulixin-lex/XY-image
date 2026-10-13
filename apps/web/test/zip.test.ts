// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createZip, crc32, uniqueNames, ZIP_MAX_ENTRIES } from "../src/lib/zip";

const text = (value: string) => new Blob([value]);

describe("zip (作品 批量下载)", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes an archive whose directory points at each stored file", async () => {
    const zip = await createZip([
      { name: "夏日市集.png", data: text("first picture"), modified: new Date(2026, 9, 12, 9, 30) },
      { name: "b.webp", data: text("second") },
    ]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    let at = view.getUint32(end + 16, true);
    const names: string[] = [];
    for (let i = 0; i < 2; i++) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      expect(view.getUint16(at + 8, true) & 0x0800).toBe(0x0800);
      const length = view.getUint16(at + 28, true);
      const local = view.getUint32(at + 42, true);
      const size = view.getUint32(at + 24, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + length));
      names.push(name);
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      const data = bytes.subarray(local + 30 + length, local + 30 + length + size);
      expect(crc32(data)).toBe(view.getUint32(at + 16, true));
      at += 46 + length;
    }
    expect(names).toEqual(["夏日市集.png", "b.webp"]);
  });

  // Python's zipfile reads the UTF-8 flag like Finder and Windows do (the
  // Info-ZIP unzip that ships with macOS does not).
  it("is readable by another ZIP reader, 中文 names included", async () => {
    const zip = await createZip([{ name: "作品/一.png", data: text("abc") }]);
    const dir = mkdtempSync(join(tmpdir(), "xy-zip-"));
    try {
      const file = join(dir, "t.zip");
      writeFileSync(file, Buffer.from(await zip.arrayBuffer()));
      let out: string;
      try {
        out = execFileSync(
          "python3",
          ["-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;n=z.namelist()[0];print(n+'='+z.read(n).decode())", file],
          { encoding: "utf8" },
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      expect(out.trim()).toBe("作品/一.png=abc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("numbers duplicate names and refuses an oversized archive", async () => {
    expect(uniqueNames(["a.png", "a.png", "b", "b", "a.png"])).toEqual([
      "a.png",
      "a (2).png",
      "b",
      "b (2)",
      "a (3).png",
    ]);
    const many = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({ name: `${i}`, data: text("") }));
    await expect(createZip(many)).rejects.toThrow();
  });
});
