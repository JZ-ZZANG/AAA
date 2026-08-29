const test = require("node:test");
const assert = require("node:assert/strict");

test("모든 태그 조합을 만들지 않고 프로젝트 저장 규칙과 경로를 비교한다", async () => {
  const { matchesProjectPath } = await import("../src/renderer/shared.ts");
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

test("빈 저장값을 선택 태그로 사용하고 최종 경로 충돌을 찾는다", async () => {
  const { findPathRuleCollision, matchesProjectPath } = await import("../src/renderer/shared.ts");
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
  project.tags[2].values.push({ id: "ambiguous", label: "충돌 상황", value: "A001" });
  assert.equal(findPathRuleCollision(project)?.path, "M/A001.png");
});

test("분류 기준은 기본적으로 첫 항목을 사이드바, 중간 항목을 상단바, 마지막 항목을 카드에 배치한다", async () => {
  const { classificationTagAreas } = await import("../src/renderer/shared.ts");
  const tags = [{ id: "character" }, { id: "pose" }, { id: "expression" }];
  assert.deepEqual(classificationTagAreas(tags), {
    sidebarTagIds: ["character"],
    cardTagIds: ["expression"],
    topbarTagIds: ["pose"]
  });
  assert.deepEqual(classificationTagAreas(tags.slice(0, 2)), {
    sidebarTagIds: ["character"],
    cardTagIds: ["pose"],
    topbarTagIds: []
  });
  assert.deepEqual(classificationTagAreas(tags.slice(0, 1)), {
    sidebarTagIds: ["character"],
    cardTagIds: [],
    topbarTagIds: []
  });
});

test("저장한 분류 영역 배치를 적용하고 중복 및 삭제된 기준을 제거한다", async () => {
  const { classificationTagAreas } = await import("../src/renderer/shared.ts");
  const tags = [{ id: "character" }, { id: "pose" }, { id: "expression" }];
  assert.deepEqual(classificationTagAreas(tags, {
    sidebarTagIds: ["pose", "pose", "deleted"],
    topbarTagIds: ["pose", "character"]
  }), {
    sidebarTagIds: ["pose"],
    cardTagIds: ["expression"],
    topbarTagIds: ["character"]
  });
});
