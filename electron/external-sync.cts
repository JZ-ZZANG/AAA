const fs = require("node:fs");
const path = require("node:path");
const { originAssetRoot } = require("./project-paths.cjs");

function logicalKey(relativePath) {
  const extension = path.extname(relativePath);
  return relativePath.slice(0, relativePath.length - extension.length).replaceAll("\\", "/").toLowerCase();
}

async function scanFiles(root, targetExtension, current = root, output = []) {
  let entries;
  try { entries = await fs.promises.readdir(current, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return output; throw error; }
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) await scanFiles(root, targetExtension, fullPath, output);
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === targetExtension) {
      let stats;
      try { stats = await fs.promises.stat(fullPath); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      output.push({
        sourceName: entry.name,
        relativePath: path.relative(root, fullPath),
        savedPath: fullPath,
        extension: path.extname(entry.name).toLowerCase(),
        fileSize: stats.size,
        modifiedAt: stats.mtimeMs
      });
    }
  }
  return output;
}

async function scanProjectInventory(project, targetExtension) {
  return (await scanFiles(originAssetRoot(project), targetExtension)).map((file) => ({ ...file, duplicateCount: 0 }));
}

async function refreshTrackedFiles(assets) {
  const output = [];
  for (const asset of assets) {
    try {
      const stats = await fs.promises.stat(asset.savedPath);
      if (stats.isFile()) output.push({ id: asset.id, fileSize: stats.size, modifiedAt: stats.mtimeMs });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return output;
}

module.exports = { scanProjectInventory, refreshTrackedFiles, logicalKey };
