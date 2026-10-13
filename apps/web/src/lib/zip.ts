/**
 * A minimal ZIP writer for 作品 批量下载 (第 58 条). Entries are STORED (no
 * compression): PNG, WebP and JPEG are compressed already, so deflate would
 * only cost time. The archive is a Blob of the parts, so the browser can keep
 * large pictures out of the JS heap; only each file's CRC needs its bytes.
 *
 * Names are UTF-8 (general purpose flag bit 11), so 中文 file names survive
 * on macOS, Windows 10+ and Linux unzip. No ZIP64: callers keep an archive
 * under 4 GB and 65 535 entries (ZIP_MAX_ENTRIES caps it far lower).
 */

/** Most pictures one archive takes; more is too much to hold in a tab. */
export const ZIP_MAX_ENTRIES = 200;

export type ZipEntry = { name: string; data: Blob; modified?: Date };

let crcTable: Uint32Array | null = null;

function table() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

export function crc32(bytes: Uint8Array): number {
  const t = table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (t[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, as ZIP headers keep them (2-second steps, local time). */
function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Makes names unique inside the archive: a.png, a (2).png, a (3).png. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf(".");
    const next = dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
    seen.set(next, 1);
    return next;
  });
}

export async function createZip(entries: ZipEntry[]): Promise<Blob> {
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error(`zip: more than ${ZIP_MAX_ENTRIES} entries`);
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const bytes = new Uint8Array(await entry.data.arrayBuffer());
    const crc = crc32(bytes);
    const size = bytes.length;
    const { time, date } = dosDateTime(entry.modified ?? new Date());

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, entry.data);

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true); // central directory header
    record.setUint16(4, 20, true); // made by
    record.setUint16(6, 20, true); // version needed
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, 0, true);
    record.setUint16(12, time, true);
    record.setUint16(14, date, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, size, true);
    record.setUint32(24, size, true);
    record.setUint16(28, name.length, true);
    // extra, comment, disk, internal attrs, external attrs: 0
    record.setUint32(42, offset, true);
    const header = new Uint8Array(46 + name.length);
    header.set(new Uint8Array(record.buffer), 0);
    header.set(name, 46);
    central.push(header);

    offset += 30 + name.length + size;
  }

  const centralSize = central.reduce((sum, header) => sum + header.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}
