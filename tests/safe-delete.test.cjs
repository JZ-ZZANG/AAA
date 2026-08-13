const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { withStagedFileDeletion } = require("../electron/safe-delete.cjs");

test("DB 변경이 성공하면 준비된 파일을 최종 삭제한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-safe-delete-"));
  try {
    const target = path.join(root, "asset.png");
    fs.writeFileSync(target, "image");
    const result = await withStagedFileDeletion([target], () => "deleted");
    assert.equal(result, "deleted");
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("DB 변경이 실패하면 준비된 파일을 원래 위치로 복원한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-safe-delete-"));
  try {
    const target = path.join(root, "asset.png");
    fs.writeFileSync(target, "original");
    await assert.rejects(withStagedFileDeletion([target], () => { throw new Error("DB failure"); }), /DB failure/);
    assert.equal(fs.readFileSync(target, "utf8"), "original");
    assert.deepEqual(fs.readdirSync(root), ["asset.png"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
