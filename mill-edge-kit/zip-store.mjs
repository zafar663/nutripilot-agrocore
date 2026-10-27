import zlib from 'zlib';

/** Store-only ZIP (no compression). Node 20 compatible. */
function crc32(buf) {
  return zlib.crc32(buf) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/**
 * @param {{ name: string, data: Buffer }[]} files
 * @returns {Buffer}
 */
export function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(String(f.name).replace(/\\/g, "/"), "utf8");
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const crc = crc32(data);
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(name.length), u16(0),
      name, data,
    ]);
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0), u16(0),
    u16(files.length), u16(files.length),
    u32(centralBuf.length), u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralBuf, end]);
}
