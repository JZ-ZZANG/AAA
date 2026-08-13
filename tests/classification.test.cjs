const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { copyClassifiedAsset, renderRelativePath } = require("../electron/classification.cjs");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-classification-"));
  const source = path.join(root, "source.png");
  fs.writeFileSync(source, Buffer.from("test-image"));
  const project = {
    savePath: path.join(root, "output"),
    pathTemplate: "{tag:character}/{tag:expression}.{extension}",
    tags: [
      { id: "character", name: "캐릭터", values: [{ id: "char-a", value: "A" }] },
      { id: "expression", name: "표정", values: [{ id: "face-1", value: "01" }] }
    ]
  };
  return { root, source, sourcePath: source, project, selections: { character: "char-a", expression: "face-1" } };
}

test("태그와 확장자로 상대 경로를 만든다", () => {
  const data = fixture();
  try { assert.equal(renderRelativePath(data.project, data.selections, data.source), path.join("A", "01.png")); }
  finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test("저장 규칙에서 사용하지 않은 분류 기준은 선택하지 않아도 된다", () => {
  const data = fixture();
  data.project.tags.push({ id: "unused", name: "나중에 사용할 기준", values: [{ id: "unused-1", value: "보류" }] });
  try {
    assert.equal(renderRelativePath(data.project, data.selections, data.sourcePath), path.join("A", "01.png"));
  } finally {
    fs.rmSync(data.root, { recursive: true, force: true });
  }
});

test("원본을 유지하고 대상 경로에 복사한다", async () => {
  const data = fixture();
  try {
    const result = await copyClassifiedAsset(data);
    assert.equal(result.collision, false);
    assert.equal(result.destination, path.join(data.project.savePath, "origin_asset", "A", "01.png"));
    assert.equal(fs.readFileSync(data.source, "utf8"), "test-image");
    assert.equal(fs.readFileSync(result.destination, "utf8"), "test-image");
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test("기존 대상 파일을 확인 없이 덮어쓰지 않는다", async () => {
  const data = fixture();
  try {
    await copyClassifiedAsset(data);
    const second = await copyClassifiedAsset(data);
    assert.equal(second.collision, true);
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test("원본 확장자를 유지해서 복사한다", async () => {
  const data = fixture();
  try {
    const jpgSource = path.join(data.root, "replacement.jpg");
    fs.writeFileSync(jpgSource, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    const replaced = await copyClassifiedAsset({ ...data, sourcePath: jpgSource, overwrite: true });
    assert.equal(path.extname(replaced.destination), ".jpg");
    assert.deepEqual(fs.readFileSync(replaced.destination), fs.readFileSync(jpgSource));
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test("저장 루트를 벗어나는 규칙을 거부한다", async () => {
  const data = fixture();
  data.project.pathTemplate = "../outside.{extension}";
  try { await assert.rejects(() => copyClassifiedAsset(data), /사용할 수 없는|저장 위치 밖/); }
  finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});
