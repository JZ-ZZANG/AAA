import twemoji from "@twemoji/api";
import twemojiManifest from "./generated/twemoji-manifest.json";

const TWEMOJI_CATEGORIES = [["smileys", "표정"], ["people", "사람"], ["animals", "동물·자연"], ["food", "음식"], ["travel", "여행"], ["activities", "활동"], ["objects", "사물"], ["symbols", "기호"], ["flags", "깃발"], ["other", "기타"]];

function codePointInRanges(codePoint, ranges) {
  return ranges.some(([start, end = start]) => codePoint >= start && codePoint <= end);
}

function twemojiCategory(id) {
  const codePoint = Number.parseInt(id.split("-")[0], 16);
  if ((codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff) || id.startsWith("1f3f4-e") || ["1f3c1", "1f38c", "1f3f3", "1f3f4", "1f6a9"].includes(id.split("-")[0])) return "flags";
  if (codePointInRanges(codePoint, [[0x1f600, 0x1f644], [0x1f910, 0x1f917], [0x1f920, 0x1f925], [0x1f927, 0x1f92f], [0x1f970, 0x1f976], [0x1f978, 0x1f97a], [0x1fae0, 0x1fae9]]) || [0x2639, 0x263a, 0x1f47b, 0x1f47d, 0x1f47e, 0x1f47f, 0x1f480, 0x1f4a9, 0x1f916, 0x1f921, 0x1f9d0, 0x2763, 0x2764, 0x1f48b, 0x1f48c, 0x1f494, 0x1f495, 0x1f496, 0x1f497, 0x1f498, 0x1f499, 0x1f49a, 0x1f49b, 0x1f49c, 0x1f49d, 0x1f49e, 0x1f49f, 0x1f5a4, 0x1fa75, 0x1fa76, 0x1fa77, 0x1fa78, 0x1fa79].includes(codePoint)) return "smileys";
  if (codePointInRanges(codePoint, [[0x1f3fb, 0x1f3ff], [0x1f44a, 0x1f450], [0x1f466, 0x1f487], [0x1f574, 0x1f575], [0x1f590], [0x1f595, 0x1f596], [0x1f645, 0x1f64f], [0x1f6b4, 0x1f6b6], [0x1f90c, 0x1f90f], [0x1f918, 0x1f91f], [0x1f926], [0x1f930, 0x1f939], [0x1f93c, 0x1f93e], [0x1f9b0, 0x1f9b9], [0x1f9bb, 0x1f9bd], [0x1f9cd, 0x1f9dd], [0x1fac3, 0x1fac5], [0x1faf0, 0x1faf8]]) || [0x1f48f, 0x1f491, 0x1f4aa, 0x1f57a, 0x1f6a3, 0x1f6c0, 0x1f6cc, 0x1f977].includes(codePoint)) return "people";
  if (codePointInRanges(codePoint, [[0x1f330, 0x1f343], [0x1f400, 0x1f43e], [0x1f980, 0x1f9ae], [0x1fab0, 0x1fabf]]) || [0x2618, 0x1f940].includes(codePoint)) return "animals";
  if (codePointInRanges(codePoint, [[0x1f344, 0x1f37f], [0x1f950, 0x1f96f], [0x1f9c0, 0x1f9cb], [0x1fad0, 0x1fada]]) || codePoint === 0x2615) return "food";
  if (codePointInRanges(codePoint, [[0x1f300, 0x1f32f], [0x1f3e0, 0x1f3f0], [0x1f550, 0x1f567], [0x1f680, 0x1f6c5], [0x1f6e0, 0x1f6ec], [0x1f6f0, 0x1f6fc]]) || [0x1f5fa, 0x2600, 0x2601, 0x2602, 0x2603, 0x2604, 0x26c4, 0x26c5, 0x26f0, 0x26f1, 0x26f2, 0x26f3, 0x26f4, 0x26f5].includes(codePoint)) return "travel";
  if (codePointInRanges(codePoint, [[0x1f380, 0x1f3c4], [0x1f3c5, 0x1f3d3], [0x1f3f8, 0x1f3fa], [0x1f93a, 0x1f93e], [0x1fa80, 0x1fa86]]) || [0x26bd, 0x26be, 0x26f3, 0x26f8, 0x1f9e9].includes(codePoint)) return "activities";
  if (codePoint < 0x3300 || codePointInRanges(codePoint, [[0x1f170, 0x1f251], [0x1f500, 0x1f53d], [0x1f7e0, 0x1f7eb]])) return "symbols";
  if (codePointInRanges(codePoint, [[0x1f3a4, 0x1f3b8], [0x1f4a0, 0x1f4ff], [0x1f540, 0x1f5f4], [0x1f6aa, 0x1f6b2], [0x1f9e2, 0x1f9ff], [0x1fa70, 0x1fa7c], [0x1fa90, 0x1faff]])) return "objects";
  return "other";
}

const categorizedTwemojiIds = Object.fromEntries(TWEMOJI_CATEGORIES.map(([key]) => [key, twemojiManifest.filter((id) => twemojiCategory(id) === key)]));

function twemojiCharacter(id) {
  try { return twemoji.convert.fromCodePoint(id); }
  catch { return ""; }
}

function twemojiSticker(id) {
  const character = twemojiCharacter(id);
  return { id: `twemoji:${id}`, name: character, twemojiId: id, url: `aaa-asset://local/twemoji/${id}.svg` };
}

export { TWEMOJI_CATEGORIES, categorizedTwemojiIds, twemojiCharacter, twemojiManifest, twemojiSticker };
