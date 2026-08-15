const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");

const STICKER_SOURCE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".bmp", ".svg"]);
const MAX_STICKER_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_STICKER_EDGE = 2048;

function stickerDisplayName(fileName) {
  return path.basename(fileName, path.extname(fileName)).replace(/^[0-9a-f-]{36}__/, "").replaceAll("_", " ");
}

function safeStickerId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || path.basename(id) !== id || !/^[0-9a-f-]{36}__[^<>:"/\\|?*\x00-\x1f]+\.png$/i.test(id)) throw new Error("스티커 ID가 올바르지 않습니다.");
  return id;
}

function safeStickerName(sourcePath) {
  const base = path.basename(sourcePath, path.extname(sourcePath)).normalize("NFKC").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").trim();
  return (base || "sticker").slice(0, 80);
}

async function listStickers(rootPath) {
  await fs.promises.mkdir(rootPath, { recursive: true });
  const entries = await fs.promises.readdir(rootPath, { withFileTypes: true });
  const stickers = [];
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".png") continue;
    try {
      const id = safeStickerId(entry.name);
      const stats = await fs.promises.stat(path.join(rootPath, id));
      stickers.push({ id, name: stickerDisplayName(id), modifiedAt: stats.mtimeMs });
    } catch {}
  }
  return stickers.sort((left, right) => right.modifiedAt - left.modifiedAt);
}

async function addStickers(rootPath, sourcePaths) {
  await fs.promises.mkdir(rootPath, { recursive: true });
  for (const sourcePathValue of sourcePaths) {
    const sourcePath = path.resolve(sourcePathValue);
    const extension = path.extname(sourcePath).toLowerCase();
    const stats = await fs.promises.stat(sourcePath);
    if (!stats.isFile() || !STICKER_SOURCE_EXTENSIONS.has(extension) || stats.size > MAX_STICKER_SOURCE_BYTES) throw new Error("20MB 이하의 지원되는 이미지 파일을 선택해 주세요.");
    const id = `${crypto.randomUUID()}__${safeStickerName(sourcePath)}.png`;
    const destination = path.join(rootPath, id);
    await sharp(sourcePath, { animated: false, density: 192 }).rotate().resize(MAX_STICKER_EDGE, MAX_STICKER_EDGE, { fit: "inside", withoutEnlargement: true }).png().toFile(destination);
  }
  return listStickers(rootPath);
}

async function deleteSticker(rootPath, idValue) {
  const id = safeStickerId(idValue);
  const targetPath = path.resolve(rootPath, id);
  if (path.dirname(targetPath).toLowerCase() !== path.resolve(rootPath).toLowerCase()) throw new Error("스티커 경로가 올바르지 않습니다.");
  try { await fs.promises.unlink(targetPath); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return listStickers(rootPath);
}

function stickerPath(rootPath, idValue) {
  const id = safeStickerId(idValue);
  const targetPath = path.resolve(rootPath, id);
  if (path.dirname(targetPath).toLowerCase() !== path.resolve(rootPath).toLowerCase()) throw new Error("스티커 경로가 올바르지 않습니다.");
  return targetPath;
}

module.exports = { STICKER_SOURCE_EXTENSIONS, addStickers, deleteSticker, listStickers, safeStickerId, stickerPath };
