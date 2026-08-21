import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const ZERO_BLOCK = Buffer.alloc(512);
const DEFAULT_LIMITS = Object.freeze({ maxFiles: 256, maxTotalBytes: 64 * 1024 * 1024, maxEntryBytes: 32 * 1024 * 1024 });

function unsafePath(path) {
  return typeof path !== "string"
    || path.length === 0
    || path.length > 240
    || path.includes("\0")
    || path.includes("\\")
    || path.startsWith("/")
    || /^[A-Za-z]:/u.test(path)
    || path.split("/").some((part) => part === "" || part === "." || part === "..");
}

export function validateArchiveEntries(entries, limits = DEFAULT_LIMITS) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > limits.maxFiles) throw new Error("archive_file_count_invalid");
  const exact = new Set(); const folded = new Set(); let total = 0;
  const validated = entries.map((entry) => {
    if (unsafePath(entry?.path)) throw new Error(`unsafe_archive_path:${entry?.path ?? ""}`);
    const path = entry.path.normalize("NFC");
    const collision = path.toLocaleLowerCase("en-US");
    if (exact.has(path) || folded.has(collision)) throw new Error(`archive_path_collision:${path}`);
    exact.add(path); folded.add(collision);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? "");
    if (data.length > limits.maxEntryBytes) throw new Error(`archive_entry_too_large:${path}`);
    total += data.length;
    if (total > limits.maxTotalBytes) throw new Error("archive_total_too_large");
    const mode = entry.mode ?? 0o644;
    if (mode !== 0o644 && mode !== 0o755) throw new Error(`unsafe_archive_mode:${path}`);
    return Object.freeze({ path, data, mode });
  });
  return validated.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
}

function writeOctal(buffer, offset, length, value) {
  const text = Math.trunc(value).toString(8).padStart(length - 1, "0");
  if (text.length >= length) throw new Error("tar_numeric_field_overflow");
  buffer.write(text, offset, length - 1, "ascii"); buffer[offset + length - 1] = 0;
}

function splitTarPath(path) {
  const bytes = Buffer.byteLength(path);
  if (bytes <= 100) return { name: path, prefix: "" };
  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    const prefix = path.slice(0, index); const name = path.slice(index + 1);
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) return { name, prefix };
  }
  throw new Error(`tar_path_too_long:${path}`);
}

function tarHeader(entry) {
  const header = Buffer.alloc(512); const { name, prefix } = splitTarPath(entry.path);
  header.write(name, 0, 100, "utf8"); writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, 0); writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.data.length); writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156); header[156] = 0x30;
  header.write("ustar\0", 257, 6, "ascii"); header.write("00", 263, 2, "ascii");
  if (prefix) header.write(prefix, 345, 155, "utf8");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText, 148, 6, "ascii"); header[154] = 0; header[155] = 0x20;
  return header;
}

function createTar(entries) {
  const blocks = [];
  for (const entry of validateArchiveEntries(entries)) {
    blocks.push(tarHeader(entry), entry.data);
    const remainder = entry.data.length % 512;
    if (remainder !== 0) blocks.push(Buffer.alloc(512 - remainder));
  }
  blocks.push(ZERO_BLOCK, ZERO_BLOCK);
  return Buffer.concat(blocks);
}

export async function createDeterministicTarGzip(outputPath, entries) {
  const compressed = gzipSync(createTar(entries), { level: 9, mtime: 0 });
  await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, compressed);
}

function parseOctal(buffer, offset, length) {
  const value = buffer.subarray(offset, offset + length).toString("ascii").replace(/\0.*$/u, "").trim();
  if (!/^[0-7]*$/u.test(value)) throw new Error("invalid_tar_numeric_field");
  return value === "" ? 0 : Number.parseInt(value, 8);
}

function tarName(header) {
  const read = (offset, length) => header.subarray(offset, offset + length).toString("utf8").replace(/\0.*$/u, "");
  const name = read(0, 100); const prefix = read(345, 155);
  return prefix ? `${prefix}/${name}` : name;
}

function inspectTarBuffer(buffer, limits = DEFAULT_LIMITS) {
  if (buffer.length % 512 !== 0) throw new Error("invalid_tar_block_length");
  const entries = []; let offset = 0; let zeroBlocks = 0; let total = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512); offset += 512;
    if (header.every((byte) => byte === 0)) { zeroBlocks += 1; if (zeroBlocks === 2) break; continue; }
    if (zeroBlocks !== 0) throw new Error("invalid_tar_terminator");
    const storedChecksum = parseOctal(header, 148, 8); const checksumHeader = Buffer.from(header); checksumHeader.fill(0x20, 148, 156);
    if (checksumHeader.reduce((sum, byte) => sum + byte, 0) !== storedChecksum) throw new Error("invalid_tar_checksum");
    const type = header[156];
    if (type !== 0 && type !== 0x30) throw new Error("unsafe_archive_entry_type");
    const path = tarName(header); const size = parseOctal(header, 124, 12); const mode = parseOctal(header, 100, 8) & 0o777;
    if (offset + size > buffer.length) throw new Error("truncated_tar_entry");
    entries.push({ path, data: Buffer.from(buffer.subarray(offset, offset + size)), mode }); total += size;
    if (size > limits.maxEntryBytes || total > limits.maxTotalBytes || entries.length > limits.maxFiles) throw new Error("archive_limits_exceeded");
    offset += Math.ceil(size / 512) * 512;
  }
  if (zeroBlocks !== 2) throw new Error("missing_tar_terminator");
  if (buffer.subarray(offset).some((byte) => byte !== 0)) throw new Error("invalid_tar_trailing_data");
  return validateArchiveEntries(entries, limits);
}

export async function inspectTarGzip(inputPath, limits = DEFAULT_LIMITS) {
  const compressed = await readFile(inputPath);
  if (compressed.length === 0) throw new Error("empty_archive");
  let expanded;
  try { expanded = gunzipSync(compressed, { maxOutputLength: limits.maxTotalBytes + limits.maxFiles * 1024 }); }
  catch { throw new Error("invalid_or_oversized_tar_gzip"); }
  if (expanded.length > Math.max(compressed.length * 200, 1024 * 1024)) throw new Error("archive_compression_ratio_exceeded");
  return inspectTarBuffer(expanded, limits);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function createDeterministicZip(outputPath, entries) {
  const locals = []; const centrals = []; let localOffset = 0;
  for (const entry of validateArchiveEntries(entries)) {
    const name = Buffer.from(entry.path, "utf8"); const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(entry.data.length, 18); local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, name, entry.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(entry.data.length, 20); central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36); central.writeUInt32LE(((0o100000 | entry.mode) << 16) >>> 0, 38); central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name); localOffset += local.length + name.length + entry.data.length;
  }
  const centralBuffer = Buffer.concat(centrals); const end = Buffer.alloc(22); const count = centrals.length / 2;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(localOffset, 16);
  await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, Buffer.concat([...locals, centralBuffer, end]));
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  throw new Error("missing_zip_directory");
}

function inspectZipBuffer(buffer, limits = DEFAULT_LIMITS) {
  const endOffset = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(endOffset + 10); const centralSize = buffer.readUInt32LE(endOffset + 12); const centralStart = buffer.readUInt32LE(endOffset + 16);
  if (count === 0 || count > limits.maxFiles || centralStart + centralSize !== endOffset) throw new Error("invalid_zip_directory");
  const entries = []; let offset = centralStart; let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > endOffset || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("invalid_zip_entry");
    const flags = buffer.readUInt16LE(offset + 8); const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20); const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28); const extraLength = buffer.readUInt16LE(offset + 30); const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42); const path = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (flags !== 0x800 || method !== 0 || compressedSize !== size || extraLength !== 0 || commentLength !== 0) throw new Error("unsafe_zip_features");
    if (localOffset + 30 > centralStart || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("invalid_zip_local_entry");
    const localNameLength = buffer.readUInt16LE(localOffset + 26); const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8");
    if (buffer.readUInt16LE(localOffset + 6) !== flags || buffer.readUInt16LE(localOffset + 8) !== method
      || buffer.readUInt32LE(localOffset + 14) !== buffer.readUInt32LE(offset + 16)
      || buffer.readUInt32LE(localOffset + 18) !== compressedSize || buffer.readUInt32LE(localOffset + 22) !== size
      || localName !== path || localExtraLength !== 0 || dataStart + size > centralStart) throw new Error("invalid_zip_local_entry");
    const data = Buffer.from(buffer.subarray(dataStart, dataStart + size));
    if (crc32(data) !== buffer.readUInt32LE(offset + 16)) throw new Error("zip_crc_mismatch");
    const externalMode = buffer.readUInt32LE(offset + 38) >>> 16;
    if ((externalMode & 0o170000) !== 0o100000) throw new Error("unsafe_archive_entry_type");
    const mode = externalMode & 0o777;
    entries.push({ path, data, mode }); total += size;
    if (size > limits.maxEntryBytes || total > limits.maxTotalBytes) throw new Error("archive_limits_exceeded");
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== endOffset) throw new Error("invalid_zip_directory_size");
  return validateArchiveEntries(entries, limits);
}

export async function inspectZip(inputPath, limits = DEFAULT_LIMITS) {
  return inspectZipBuffer(await readFile(inputPath), limits);
}

async function extractEntries(entries, outputDirectory) {
  const root = resolve(outputDirectory); await mkdir(root, { recursive: true });
  for (const entry of entries) {
    const target = resolve(root, ...entry.path.split("/"));
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("archive_extraction_escape");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.data, { flag: "wx", mode: entry.mode });
  }
}

export async function extractTarGzip(inputPath, outputDirectory, limits = DEFAULT_LIMITS) {
  await extractEntries(await inspectTarGzip(inputPath, limits), outputDirectory);
}

export async function extractZip(inputPath, outputDirectory, limits = DEFAULT_LIMITS) {
  await extractEntries(await inspectZip(inputPath, limits), outputDirectory);
}
