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

test("빈 저장값을 선택 태그로 사용하고 최종 경로 충돌을 찾는다", async () => {
  const { findPathRuleCollision, matchesProjectPath } = await import("../src/renderer/shared.js");
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
