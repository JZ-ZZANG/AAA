const fs = require("node:fs");
const path = require("node:path");
const { IMAGE_EXTENSIONS, PROJECT_EXTENSIONS } = require("./classification.cjs");

function safeRelativePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  if (!normalized || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("이미지 상대 경로가 올바르지 않습니다.");
  return normalized;
}

async function validatedImage(sourcePathValue, relativePathValue = "") {
  const sourcePath = path.resolve(String(sourcePathValue || ""));
  const extension = path.extname(sourcePath).toLowerCase();
  let stats;
  try { stats = await fs.promises.stat(sourcePath); }
  catch (error) { if (error.code === "ENOENT") throw new Error(`이미지 파일을 찾을 수 없습니다: ${path.basename(sourcePath)}`); throw error; }
  if (!stats.isFile() || !IMAGE_EXTENSIONS.has(extension)) throw new Error(`지원하지 않는 이미지 파일입니다: ${path.basename(sourcePath)}`);
  return { id: sourcePath, savedPath: sourcePath, relativePath: safeRelativePath(relativePathValue || path.basename(sourcePath)), fileSize: stats.size };
}

async function standaloneAssetsFromFiles(filePaths) {
  const uniquePaths = [...new Set((Array.isArray(filePaths) ? filePaths : []).map((item) => path.resolve(String(item || ""))))];
  const assets = await Promise.all(uniquePaths.map((sourcePath) => validatedImage(sourcePath)));
  const names = new Set();
  for (const asset of assets) {
    const key = asset.relativePath.toLocaleLowerCase();
    if (names.has(key)) throw new Error(`이름이 같은 이미지가 여러 개 있습니다: ${asset.relativePath}`);
    names.add(key);
  }
  return assets;
}

async function scanStandaloneFolder(rootPathValue) {
  const rootPath = path.resolve(String(rootPathValue || ""));
  let rootStats;
  try { rootStats = await fs.promises.stat(rootPath); }
  catch (error) { if (error.code === "ENOENT") throw new Error("선택한 폴더를 찾을 수 없습니다."); throw error; }
  if (!rootStats.isDirectory()) throw new Error("이미지가 들어 있는 폴더를 선택해 주세요.");
  const assets = [];
  const pending = [rootPath];
  while (pending.length) {
    const current = pending.pop();
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "ko"));
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) assets.push(await validatedImage(entryPath, path.relative(rootPath, entryPath)));
    }
  }
  assets.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "ko"));
  return { rootPath, assets };
}

function standaloneOutputPath(outputRootValue, asset, extensionValue = "original") {
  const outputRoot = path.resolve(String(outputRootValue || ""));
  const relativePath = safeRelativePath(asset?.relativePath);
  const sourceExtension = path.extname(String(asset?.savedPath || "")).toLowerCase();
  const outputExtension = extensionValue === "original" ? (PROJECT_EXTENSIONS.has(sourceExtension) ? sourceExtension : ".png") : PROJECT_EXTENSIONS.has(String(extensionValue || "").toLowerCase()) ? String(extensionValue).toLowerCase() : ".png";
  const outputRelativePath = relativePath.replace(/\.[^./\\]+$/, outputExtension);
  const outputPath = path.resolve(outputRoot, outputRelativePath);
  if (outputPath !== outputRoot && !outputPath.startsWith(`${outputRoot}${path.sep}`)) throw new Error("출력 폴더 밖으로 파일을 저장할 수 없습니다.");
  return outputPath;
}

module.exports = { safeRelativePath, validatedImage, standaloneAssetsFromFiles, scanStandaloneFolder, standaloneOutputPath };
