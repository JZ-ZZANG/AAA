const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { addStickers, deleteSticker, listStickers, safeStickerId, stickerPath } = require("../electron/stickers.cjs");

test("사용자 스티커를 PNG로 정규화해 저장하고 삭제한다", async (context) => {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "aaa-stickers-"));
  context.after(() => fs.promises.rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "내 하트.svg");
  const libraryPath = path.join(temporaryRoot, "library");
  await fs.promises.writeFile(sourcePath, '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="red" d="M16 29 3 16C-4 7 8-2 16 7 24-2 36 7 29 16Z"/></svg>');

  const added = await addStickers(libraryPath, [sourcePath]);
  assert.equal(added.length, 1);
  assert.equal(added[0].name, "내 하트");
  assert.equal(path.extname(stickerPath(libraryPath, added[0].id)), ".png");
  assert.equal((await listStickers(libraryPath)).length, 1);

  await deleteSticker(libraryPath, added[0].id);
  assert.equal((await listStickers(libraryPath)).length, 0);
});

test("스티커 폴더 밖을 가리키는 ID를 거부한다", () => {
  assert.throws(() => safeStickerId("../sticker.png"), /ID/);
  assert.throws(() => stickerPath("C:\\stickers", "..\\sticker.png"), /ID/);
});
