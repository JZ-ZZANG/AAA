const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scanProjectInventory } = require("../electron-dist/external-sync.cjs");

test("선택한 확장자와 일치하는 외부 파일만 가져온다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-sync-"));
  try {
    const originRoot = path.join(root, "origin_asset");
    fs.mkdirSync(path.join(originRoot, "A"), { recursive: true });
    fs.writeFileSync(path.join(originRoot, "A", "001.png"), "png");
    fs.writeFileSync(path.join(originRoot, "A", "001.jpg"), "jpg");
    const inventory = await scanProjectInventory({ savePath: root }, ".png");
    assert.equal(inventory.length, 1);
    assert.equal(inventory[0].relativePath, path.join("A", "001.png"));
    assert.equal(inventory[0].duplicateCount, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
