const fs = require("node:fs");
const path = require("node:path");

const MAX_CHARX_FILE_BYTES = 50 * 1024 * 1024;

type CharxTextEntry = { id: string; content: string };
type CharxSelectionSource = {
  prompts: CharxTextEntry[];
  situations: CharxTextEntry[];
  titleImages: { id: string; savedPath: string }[];
};

function selectEntries<Entry extends { id: string }>(entries: Entry[], ids: unknown, label: string): Entry[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) throw new Error(`${label} 선택이 올바르지 않습니다.`);
  const byId = new Map<string, Entry>(entries.map((entry) => [entry.id, entry]));
  return ids.map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`선택한 ${label}을 찾을 수 없습니다. 내보내기를 다시 열어 주세요.`);
    return entry;
  });
}

function charxSelection(source: CharxSelectionSource, options) {
  const name = typeof options?.name === "string" ? options.name.trim() : "";
  if (!name) throw new Error("카드 이름을 입력해 주세요.");
  const prompts = selectEntries(source.prompts, options.promptIds, "프롬프트");
  if (source.prompts.length && !prompts.length) throw new Error("내보낼 프롬프트를 하나 이상 선택해 주세요.");
  const situation = options.firstSituationId ? selectEntries(source.situations, [options.firstSituationId], "시작 상황")[0] : null;
  const image = options.titleImageId ? selectEntries(source.titleImages, [options.titleImageId], "대표 이미지")[0] : null;
  if (image && !image.savedPath) throw new Error("선택한 대표 이미지가 비어 있습니다.");
  if (!["display", "original"].includes(options.assetMode)) throw new Error("에셋 이미지 선택이 올바르지 않습니다.");
  return { name, prompts, situation, image };
}

async function buildCharxEntries(source, options) {
  const { name, prompts, situation, image } = charxSelection(source, options);
  const entries = [];
  const assets = [];
  let archiveBytes = 22;
  const addEntry = (name, data) => {
    if (data.length > MAX_CHARX_FILE_BYTES) throw new Error(`${name}: 개별 파일이 50MiB를 초과하여 CHARX에 포함할 수 없습니다.`);
    archiveBytes += data.length + Buffer.byteLength(name, "utf8") * 2 + 76;
    if (archiveBytes > 0xffffffff || entries.length >= 65535) throw new Error("CHARX 파일이 ZIP 형식의 크기 한도를 초과합니다.");
    entries.push({ name, data });
  };
  const addAsset = async (filePath, type, name, index) => {
    let stat;
    try { stat = await fs.promises.stat(filePath); }
    catch { throw new Error(`내보낼 이미지 파일을 찾을 수 없습니다: ${name}`); }
    if (!stat.isFile() || !stat.size) throw new Error(`내보낼 이미지 파일이 올바르지 않습니다: ${name}`);
    if (stat.size > MAX_CHARX_FILE_BYTES) throw new Error(`${name}: 개별 파일이 50MiB를 초과하여 CHARX에 포함할 수 없습니다.`);
    const extension = path.extname(filePath).slice(1).toLowerCase();
    const ext = /^[a-z0-9]+$/.test(extension) ? extension : "unknown";
    const archivePath = `assets/${type}/images/${String(index).padStart(6, "0")}.${ext}`;
    const data = await fs.promises.readFile(filePath);
    if (!data.length) throw new Error(`내보낼 이미지 파일이 비어 있습니다: ${name}`);
    addEntry(archivePath, data);
    assets.push({ type, uri: `embeded://${archivePath}`, name, ext });
  };

  if (image) await addAsset(image.savedPath, "icon", "main", 1);
  if (options.includeAssets === true) {
    for (const [index, asset] of source.assets.entries()) {
      const reviewed = ["auto", "manual"].includes(asset.reviewStatus);
      if (options.assetMode === "display" && reviewed && !asset.cleanedPath) throw new Error(`검열본을 찾을 수 없습니다: ${asset.relativePath}`);
      const filePath = options.assetMode === "display" && reviewed ? asset.cleanedPath : asset.savedPath;
      const assetName = String(asset.relativePath || asset.sourceName).replaceAll("\\", "/").replace(/\.[^/.]+$/, "");
      await addAsset(filePath, "other", assetName, index + 1);
    }
  }

  const card = {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name,
      description: prompts.map((prompt) => prompt.content).filter((content) => content.trim()).join("\n\n"),
      personality: "",
      scenario: "",
      first_mes: situation?.content || "",
      mes_example: "",
      creator_notes: source.work.introduction || "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: options.includeAlternateGreetings === true ? source.situations.filter((entry) => entry.id !== situation?.id).map((entry) => entry.content).filter((content) => content.trim()) : [],
      group_only_greetings: [],
      tags: source.work.tags || [],
      creator: typeof options.creator === "string" ? options.creator.trim() : "",
      character_version: typeof options.characterVersion === "string" ? options.characterVersion.trim() : "",
      extensions: {
        aaa: { characterPreference: source.work.characterPreference, ageRating: source.work.ageRating }
      },
      assets,
      creation_date: Math.max(0, Math.floor(Date.parse(source.project.createdAt) / 1000) || 0),
      modification_date: Math.floor(Date.now() / 1000)
    }
  };
  if (options.includeLorebooks === true) {
    card.data["character_book"] = {
      extensions: {},
      entries: source.lorebooks.map((entry, index) => ({
        id: entry.id,
        name: entry.title,
        comment: entry.title,
        keys: entry.keywords,
        content: entry.content,
        enabled: true,
        insertion_order: index,
        use_regex: false,
        constant: false,
        extensions: {}
      }))
    };
  }
  addEntry("card.json", Buffer.from(JSON.stringify(card, null, 2), "utf8"));
  return [entries[entries.length - 1], ...entries.slice(0, -1)];
}

module.exports = { buildCharxEntries, charxSelection };
