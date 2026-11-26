const path = require("node:path");

function projectRoot(project) {
  if (!project?.savePath?.trim()) throw new Error("에셋 분류 탭에서 에셋 위치를 지정해 주세요.");
  return path.resolve(project.savePath);
}

function originAssetRoot(project) {
  return path.join(projectRoot(project), "origin_asset");
}

function cleanedAssetRoot(project) {
  return path.join(projectRoot(project), "cleaned_asset");
}

module.exports = { projectRoot, originAssetRoot, cleanedAssetRoot };
