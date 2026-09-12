/**
 * Minimal ZIP writer (store / no compression).
 *
 * Generated projects only contain small UTF-8 text files, so storing them
 * uncompressed keeps the implementation dependency-free and fully correct.
 */

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number): void {
    this.push(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }

  get offset(): number {
    return this.length;
  }

  toBlob(): Blob {
    return new Blob(this.chunks as BlobPart[], { type: 'application/zip' });
  }
}

export interface ZipEntry {
  path: string;
  content: string;
}

/** Build a ZIP blob from plain-text entries. */
export function createZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const writer = new ByteWriter();
  const central: {
    nameBytes: Uint8Array;
    crc: number;
    size: number;
    offset: number;
    time: number;
    date: number;
  }[] = [];
  const stamp = dosDateTime(new Date());

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const data = encoder.encode(entry.content);
    const crc = crc32(data);
    const offset = writer.offset;

    writer.u32(0x04034b50);
    writer.u16(20);
    writer.u16(0x0800); // UTF-8 filename flag
    writer.u16(0); // store
    writer.u16(stamp.time);
    writer.u16(stamp.date);
    writer.u32(crc);
    writer.u32(data.length);
    writer.u32(data.length);
    writer.u16(nameBytes.length);
    writer.u16(0);
    writer.push(nameBytes);
    writer.push(data);

    central.push({ nameBytes, crc, size: data.length, offset, ...stamp });
  }

  const centralStart = writer.offset;
  for (const item of central) {
    writer.u32(0x02014b50);
    writer.u16(20);
    writer.u16(20);
    writer.u16(0x0800);
    writer.u16(0);
    writer.u16(item.time);
    writer.u16(item.date);
    writer.u32(item.crc);
    writer.u32(item.size);
    writer.u32(item.size);
    writer.u16(item.nameBytes.length);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u32(0);
    writer.u32(item.offset);
    writer.push(item.nameBytes);
  }

  const centralSize = writer.offset - centralStart;
  writer.u32(0x06054b50);
  writer.u16(0);
  writer.u16(0);
  writer.u16(central.length);
  writer.u16(central.length);
  writer.u32(centralSize);
  writer.u32(centralStart);
  writer.u16(0);

  return writer.toBlob();
}

/** Trigger a browser download for a blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFileStem(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'atomforge-app';
}
