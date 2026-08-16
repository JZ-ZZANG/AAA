const path = require("node:path");

function projectRoot(project) {
  return path.resolve(project.savePath);
}

function originAssetRoot(project) {
  return path.join(projectRoot(project), "origin_asset");
}

function cleanedAssetRoot(project) {
  return path.join(projectRoot(project), "cleaned_asset");
}

module.exports = { projectRoot, originAssetRoot, cleanedAssetRoot };
