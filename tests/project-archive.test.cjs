const test = require("node:test");
const assert = require("node:assert/strict");
const { createZip, readZip, safeArchiveName } = require("../electron/project-archive.cjs");

test("프로젝트 ZIP의 텍스트와 바이너리 파일을 그대로 복원한다", () => {
  const manifest = Buffer.from(JSON.stringify({ format: "aaa-project", version: 1 }), "utf8");
  const image = Buffer.from([0, 1, 2, 250, 255]);
  const restored = readZip(createZip([
    { name: "manifest.json", data: manifest },
    { name: "files/origin/A/001.png", data: image }
  ]));
  assert.deepEqual(restored.get("manifest.json"), manifest);
  assert.deepEqual(restored.get("files/origin/A/001.png"), image);
});

test("프로젝트 ZIP에서 상위 폴더로 나가는 경로를 거부한다", () => {
  assert.throws(() => safeArchiveName("../outside.png"), /안전하지 않은 경로/);
  assert.throws(() => safeArchiveName("files/../../outside.png"), /안전하지 않은 경로/);
});
