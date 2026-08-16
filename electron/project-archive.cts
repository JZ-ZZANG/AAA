const fs = require("node:fs");

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function safeArchiveName(value) {
  const name = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!name || name.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("압축파일에 안전하지 않은 경로가 있습니다.");
  return name;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(safeArchiveName(entry.name), "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function readZip(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > buffer.length) throw new Error("손상된 프로젝트 압축파일입니다.");
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    if (flags & 0x08 || method !== 0) throw new Error("이 앱에서 내보낸 무압축 ZIP 파일만 복원할 수 있습니다.");
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) throw new Error("손상된 프로젝트 압축파일입니다.");
    const name = safeArchiveName(buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    if (entries.has(name)) throw new Error("압축파일에 중복 경로가 있습니다.");
    entries.set(name, Buffer.from(buffer.subarray(dataStart, dataEnd)));
    offset = dataEnd;
  }
  if (!entries.size) throw new Error("프로젝트 압축파일을 읽을 수 없습니다.");
  return entries;
}

async function readArchive(filePath) { return readZip(await fs.promises.readFile(filePath)); }

module.exports = { createZip, readZip, readArchive, safeArchiveName };
