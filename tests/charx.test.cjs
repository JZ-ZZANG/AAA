const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { buildCharxEntries, charxSelection } = require("../electron/charx.cts");
const { createZip, readZip } = require("../electron/project-archive.cts");
const { Store } = require("../electron/store.cts");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=", "base64");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-charx-"));
  const imagePath = path.join(root, "대표.png");
  fs.writeFileSync(imagePath, PNG);
  return {
    root,
    source: {
      project: { id: "project", name: "작품", createdAt: "2026-01-01T00:00:00.000Z" },
      work: { introduction: "공개 소개 글", tags: ["판타지"], characterPreference: "ALL", ageRating: "SAFE" },
      prompts: [
        { id: "a", title: "설정", content: "  캐릭터 설정\n" },
        { id: "b", title: "규칙", content: "{{char}}의 규칙" },
        { id: "other", title: "다른 플랫폼", content: "포함하면 안 되는 다른 버전" }
      ],
      situations: [{ id: "first", content: "첫 만남" }, { id: "second", content: "다른 시작" }],
      lorebooks: [{ id: "lore", title: "학교", keywords: ["마법학교"], content: "@@exclude_keys 졸업,폐교\n학교 설정" }],
      titleImages: [{ id: "image", sourceName: "대표.png", savedPath: imagePath }],
      assets: [{ id: "asset", sourceName: "미소.png", relativePath: "캐릭터/미소.png", savedPath: imagePath, reviewStatus: "unreviewed", cleanedPath: "" }]
    },
    options: { name: "작품 카드", creator: "제작자", characterVersion: "1.2", promptIds: ["b", "a"], firstSituationId: "second", titleImageId: "image", includeLorebooks: true, includeAssets: true, assetMode: "display", includeAlternateGreetings: true }
  };
}

function cardFrom(entries) {
  return JSON.parse(entries.find((entry) => entry.name === "card.json").data.toString("utf8"));
}

test("선택한 프롬프트만 지정 순서로 합치고 CCv3 카드와 로어북 지시문을 보존한다", async (t) => {
  const { root, source, options } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entries = await buildCharxEntries(source, options);
  const zip = readZip(createZip(entries));
  const card = JSON.parse(zip.get("card.json").toString("utf8"));
  assert.equal(entries[0].name, "card.json");
  assert.equal(card.spec, "chara_card_v3");
  assert.equal(card.spec_version, "3.0");
  assert.equal(card.data.description, "{{char}}의 규칙\n\n  캐릭터 설정\n");
  assert.equal(card.data.first_mes, "다른 시작");
  assert.deepEqual(card.data.alternate_greetings, ["첫 만남"]);
  assert.deepEqual(card.data.group_only_greetings, []);
  assert.equal(card.data.creator_notes, "공개 소개 글");
  assert.equal(card.data.character_version, "1.2");
  assert.equal(card.data.creator, "제작자");
  assert.deepEqual(card.data.tags, ["판타지"]);
  assert.equal(card.data.creation_date, 1767225600);
  const lore = card.data.character_book.entries[0];
  assert.equal(lore.content, source.lorebooks[0].content);
  assert.deepEqual(lore.keys, ["마법학교"]);
  assert.equal(lore.enabled, true);
  assert.equal(lore.use_regex, false);
  assert.equal(lore.constant, false);
  for (const field of ["name", "personality", "scenario", "mes_example", "system_prompt", "post_history_instructions"]) assert.equal(typeof card.data[field], "string");
  assert.equal(JSON.stringify(card).includes(root), false);
  assert.equal(JSON.stringify(card).includes("포함하면 안 되는"), false);
});

test("한글 에셋 이름과 바이너리를 유지하면서 내부 파일명과 참조는 ASCII로 만든다", async (t) => {
  const { root, source, options } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  source.assets.push({ ...source.assets[0], id: "second", relativePath: "다른 캐릭터/미소.png" });
  const entries = await buildCharxEntries(source, options);
  const zip = readZip(createZip(entries));
  const card = cardFrom(entries);
  assert.equal(new Set(entries.map((entry) => entry.name)).size, entries.length);
  assert.equal(entries.every((entry) => /^[\x20-\x7e]+$/.test(entry.name)), true);
  assert.deepEqual(card.data.assets.map((asset) => asset.name), ["main", "캐릭터/미소", "다른 캐릭터/미소"]);
  for (const asset of card.data.assets) {
    assert.equal(asset.uri.startsWith("embeded://"), true);
    assert.deepEqual(zip.get(asset.uri.slice("embeded://".length)), PNG);
    assert.equal(asset.ext, "png");
  }
});

test("검열본 우선과 원본 선택을 구분하고 사라진 검열본을 원본으로 대체하지 않는다", async (t) => {
  const { root, source, options } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cleanedPath = path.join(root, "검열본.webp");
  fs.writeFileSync(cleanedPath, "cleaned");
  source.assets[0] = { ...source.assets[0], reviewStatus: "manual", cleanedPath };
  const display = await buildCharxEntries(source, options);
  const displayAsset = cardFrom(display).data.assets.find((asset) => asset.type === "other");
  assert.equal(displayAsset.ext, "webp");
  assert.equal(displayAsset.name, "캐릭터/미소");
  assert.equal(display.find((entry) => entry.name === displayAsset.uri.slice(10)).data.toString(), "cleaned");
  const original = await buildCharxEntries(source, { ...options, assetMode: "original" });
  assert.equal(cardFrom(original).data.assets.find((asset) => asset.type === "other").ext, "png");
  fs.unlinkSync(cleanedPath);
  await assert.rejects(buildCharxEntries(source, options), /찾을 수 없습니다/);
  source.assets[0].cleanedPath = "";
  await assert.rejects(buildCharxEntries(source, options), /검열본을 찾을 수 없습니다/);
});

test("누락된 선택 항목과 다른 버전 ID 및 중복 선택을 거부한다", (t) => {
  const { root, source, options } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const promptIds of [["unknown"], ["a", "a"], [], null]) assert.throws(() => charxSelection(source, { ...options, promptIds }), /프롬프트/);
  assert.throws(() => charxSelection(source, { ...options, firstSituationId: "unknown" }), /시작 상황/);
  assert.throws(() => charxSelection(source, { ...options, titleImageId: "unknown" }), /대표 이미지/);
  assert.throws(() => charxSelection(source, { ...options, name: "  " }), /카드 이름/);
});

test("개별 이미지의 50MiB 한도를 검사하고 누락된 파일을 조용히 제외하지 않는다", async (t) => {
  const { root, source, options } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tooLarge = path.join(root, "large.png");
  fs.writeFileSync(tooLarge, "");
  fs.truncateSync(tooLarge, 50 * 1024 * 1024 + 1);
  source.assets[0].savedPath = tooLarge;
  await assert.rejects(buildCharxEntries(source, options), /50MiB/);
  source.assets[0].savedPath = path.join(root, "missing.png");
  await assert.rejects(buildCharxEntries(source, options), /찾을 수 없습니다/);
  const emptyPath = path.join(root, "empty.png");
  fs.writeFileSync(emptyPath, "");
  source.assets[0].savedPath = emptyPath;
  await assert.rejects(buildCharxEntries(source, options), /올바르지 않습니다/);
});

test("선택하지 않은 로어북·에셋·대체 시작 메시지를 제외하며 빈 작품도 저장한다", async (t) => {
  const { root, source, options } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entries = await buildCharxEntries(source, { ...options, titleImageId: "", includeAssets: false, includeLorebooks: false, includeAlternateGreetings: false });
  assert.deepEqual(entries.map((entry) => entry.name), ["card.json"]);
  const card = cardFrom(entries);
  assert.equal(card.data.character_book, undefined);
  assert.deepEqual(card.data.assets, []);
  assert.deepEqual(card.data.alternate_greetings, []);
  const empty = { ...source, prompts: [], situations: [], lorebooks: [], titleImages: [], assets: [] };
  const emptyCard = cardFrom(await buildCharxEntries(empty, { ...options, promptIds: [], firstSituationId: "", titleImageId: "" }));
  assert.equal(emptyCard.data.description, "");
  assert.equal(emptyCard.data.first_mes, "");
});

test("내보내기 IPC는 실제 저장 데이터로 CHARX를 만들고 편집 데이터를 변경하지 않는다", async (t) => {
  const { root } = fixture();
  const store = new Store(path.join(root, "test.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const project = store.createProject({ name: "작품", savePath: root });
  const prompt = store.createPrompt(project.id);
  store.savePrompt({ ...prompt, title: "RisuAI용", content: "메인 설정" });
  const other = store.createPrompt(project.id);
  store.savePrompt({ ...other, title: "다른 플랫폼용", content: "다른 버전" });
  const before = JSON.stringify(store.getProject(project.id));
  const handlers = new Map();
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cts"), "utf8");
  const start = main.indexOf('  ipcMain.handle("projects:charx-options"');
  const end = main.indexOf('  ipcMain.handle("projects:create"', start);
  assert.ok(start >= 0 && end > start);
  let cancel = false;
  let dialogCalls = 0;
  const outputPath = path.join(root, "export");
  const context = {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, store, fs, path, createZip, buildCharxEntries, charxSelection,
    requiredText: (value) => { assert.equal(typeof value, "string"); assert.ok(value.trim()); return value.trim(); },
    BrowserWindow: { fromWebContents: () => ({}) },
    dialog: { showSaveDialog: async () => { dialogCalls += 1; return { canceled: cancel, filePath: outputPath }; } }
  };
  vm.runInNewContext(main.slice(start, end), context);
  const available = handlers.get("projects:charx-options")({}, project.id);
  assert.deepEqual(available.prompts.map((entry) => entry.id), [prompt.id, other.id]);
  const options = { projectId: project.id, name: "작품", promptIds: [prompt.id], assetMode: "display" };
  const output = await handlers.get("projects:export-charx")({ sender: {} }, options);
  assert.equal(output, `${outputPath}.charx`);
  const card = JSON.parse(readZip(fs.readFileSync(output)).get("card.json").toString());
  assert.equal(card.data.description, "메인 설정");
  assert.equal(JSON.stringify(store.getProject(project.id)), before);
  assert.equal(store.getPrompt(other.id).content, "다른 버전");
  cancel = true;
  assert.equal(await handlers.get("projects:export-charx")({ sender: {} }, options), null);
  await assert.rejects(handlers.get("projects:export-charx")({ sender: {} }, { ...options, promptIds: ["unknown"] }), /프롬프트/);
  assert.equal(dialogCalls, 2);
});
