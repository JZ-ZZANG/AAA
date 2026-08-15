const STICKER_FAVORITES_EVENT = "aaa-sticker-favorites-changed";

function normalizedStickerFavoriteIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === "string" && /^[0-9a-f]+(?:-[0-9a-f]+)*$/i.test(id)).map((id) => id.toLowerCase()))];
}

function readStickerFavoriteIds() {
  try { return normalizedStickerFavoriteIds(JSON.parse(localStorage.getItem("aaa-preferences") || "{}").stickers?.favoriteEmojiIds); }
  catch { return []; }
}

function publishStickerFavoriteIds(ids) {
  const normalized = normalizedStickerFavoriteIds(ids);
  window.dispatchEvent(new CustomEvent(STICKER_FAVORITES_EVENT, { detail: normalized }));
  return normalized;
}

export { STICKER_FAVORITES_EVENT, normalizedStickerFavoriteIds, publishStickerFavoriteIds, readStickerFavoriteIds };
