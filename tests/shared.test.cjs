const test = require("node:test");
const assert = require("node:assert/strict");

test("모든 태그 조합을 만들지 않고 프로젝트 저장 규칙과 경로를 비교한다", async () => {
  const { matchesProjectPath } = await import("../src/renderer/shared.js");
  const project = {
    pathTemplate: "{tag:character}/{tag:pose}.{extension}",
    tags: [
      { id: "character", values: [{ value: "alice" }, { value: "bob" }] },
      { id: "pose", values: [{ value: "idle" }, { value: "run" }] },
      { id: "unused", values: [{ value: "ignored" }] }
    ]
  };

  assert.equal(matchesProjectPath(project, "alice\\run.png"), true);
  assert.equal(matchesProjectPath(project, "bob/idle.webp"), true);
  assert.equal(matchesProjectPath(project, "charlie/idle.png"), false);
  assert.equal(matchesProjectPath(project, "alice/jump.png"), false);
});

test("플랫폼용 이미지 이름과 파일을 분류 표시값으로 구성한다", async () => {
  const { assetClassification, groupPlatformAssetsByFolder, platformAssets } = await import("../src/renderer/shared.js");
  const project = {
    pathTemplate: "{tag:character}/{tag:outfit}/{tag:situation}.{extension}",
    tags: [
      { id: "character", name: "캐릭터", values: [{ value: "alice", label: "앨리스" }] },
      { id: "outfit", name: "의상", values: [{ value: "uniform", label: "교복" }] },
      { id: "situation", name: "상황", values: [{ value: "smile", label: "미소" }] }
    ]
  };
  assert.deepEqual(assetClassification(project, "alice/uniform/smile.png"), { name: "앨리스/교복/미소", classification: { 캐릭터: "앨리스", 의상: "교복", 상황: "미소" } });
  const assets = [{ relativePath: "alice/uniform/smile.png", savedPath: "origin.png", cleanedPath: "cleaned.png" }, { relativePath: "alice/uniform/smile2.png", savedPath: "origin2.png", cleanedPath: "" }];
  assert.equal(platformAssets(project, assets, "internal", "origin").length, 1);
  assert.equal(platformAssets(project, assets, "internal", "origin")[0].relativePath, "alice/uniform/smile.png");
  assert.equal(platformAssets(project, assets, "internal", "cleaned").length, 1);
  assert.deepEqual(platformAssets(project, assets, "external", "origin"), []);
  const grouped = groupPlatformAssetsByFolder([
    { relativePath: "alice/uniform/happy/smile.png" },
    { relativePath: "alice/uniform/idle.png" },
    { relativePath: "alice/casual/idle.png" },
    { relativePath: "bob/idle.png" },
    { relativePath: "root.png" }
  ]);
  assert.deepEqual(grouped.map(({ path, name, count }) => ({ path, name, count })), [
    { path: "", name: "루트", count: 5 },
    { path: "alice", name: "alice", count: 3 },
    { path: "alice/uniform", name: "uniform", count: 2 },
    { path: "alice/uniform/happy", name: "happy", count: 1 },
    { path: "alice/casual", name: "casual", count: 1 },
    { path: "bob", name: "bob", count: 1 }
  ]);
  const many = groupPlatformAssetsByFolder(Array.from({ length: 150 }, (_, index) => ({ relativePath: `alice/set/${index}.png` })));
  assert.equal(many.find((folder) => folder.path === "alice").count, 150);
  assert.equal(many.find((folder) => folder.path === "alice/set").assets.length, 150);
});

test("빈 저장값을 선택 태그로 사용하고 최종 경로 충돌을 찾는다", async () => {
  const { assetClassification, findPathRuleCollision, matchesProjectPath } = await import("../src/renderer/shared.js");
  const project = {
    pathTemplate: "{tag:character}/{tag:partner}{tag:situation}.{extension}",
    tags: [
      { id: "character", name: "캐릭터", values: [{ id: "miku", label: "미쿠", value: "M" }] },
      { id: "partner", name: "상대", values: [{ id: "none", label: "없음", value: "" }, { id: "a", label: "상대 A", value: "A" }] },
      { id: "situation", name: "상황", values: [{ id: "joy", label: "기쁨", value: "001" }] }
    ]
  };
  assert.equal(findPathRuleCollision(project), null);
  assert.equal(matchesProjectPath(project, "M/001.png"), true);
  assert.deepEqual(assetClassification(project, "M/001.png"), { name: "미쿠/기쁨", classification: { 캐릭터: "미쿠", 상대: "없음", 상황: "기쁨" } });
  project.tags[2].values.push({ id: "ambiguous", label: "충돌 상황", value: "A001" });
  assert.equal(findPathRuleCollision(project)?.path, "M/A001.png");
});
