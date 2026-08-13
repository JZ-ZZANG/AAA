const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { projectRoot, originAssetRoot, cleanedAssetRoot } = require("../electron/project-paths.cjs");

test("프로젝트 내부의 에셋 폴더 경로를 일관되게 만든다", () => {
  const project = { savePath: path.join("D:", "test", "project1") };
  assert.equal(projectRoot(project), path.resolve(project.savePath));
  assert.equal(originAssetRoot(project), path.join(path.resolve(project.savePath), "origin_asset"));
  assert.equal(cleanedAssetRoot(project), path.join(path.resolve(project.savePath), "cleaned_asset"));
});
