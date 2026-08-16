const test = require("node:test");
const assert = require("node:assert/strict");

test("스티커 이모지 즐겨찾기는 사용자 순서를 유지하고 중복과 잘못된 값을 제거한다", async () => {
  const { normalizedStickerFavoriteIds } = await import("../src/renderer/sticker-favorites.ts");
  assert.deepEqual(normalizedStickerFavoriteIds(["1F600", "2764-fe0f", "1f600", "", null, "not-emoji"]), ["1f600", "2764-fe0f"]);
});
