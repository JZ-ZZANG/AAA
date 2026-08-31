const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { Store } = require("../electron-dist/store.cjs");

test("프로젝트 내부 콘텐츠를 수정하면 최근 수정 프로젝트 순서가 갱신된다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-project-recency-"));
  let store;
  try {
    store = new Store(path.join(root, "test.sqlite"));
    const editedProject = store.createProject({ name: "수정할 프로젝트", savePath: path.join(root, "edited") });
    const otherProject = store.createProject({ name: "다른 프로젝트", savePath: path.join(root, "other") });
    const prompt = store.createPrompt(editedProject.id);

    store.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", editedProject.id);
    store.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", otherProject.id);
    const saved = store.savePrompt({ ...prompt, title: "수정된 프롬프트", content: "새 내용" });

    assert.equal(store.listProjects()[0].id, editedProject.id);
    assert.equal(store.getProject(editedProject.id).updatedAt, saved.updatedAt);

    store.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", editedProject.id);
    store.savePrompt(saved);
    assert.equal(store.getProject(editedProject.id).updatedAt, "2000-01-01T00:00:00.000Z", "변경 없는 자동 저장은 프로젝트 수정 시각을 바꾸지 않는다");
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("기존 프로젝트 DB를 스키마 변경 없이 열고 최근 수정 시각을 갱신한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-project-recency-legacy-"));
  const databasePath = path.join(root, "legacy.sqlite");
  let store;
  const legacy = new DatabaseSync(databasePath);
  try {
    legacy.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        save_path TEXT NOT NULL,
        external_tracking INTEGER NOT NULL DEFAULT 0,
        censorship_config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE prompts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const insertProject = legacy.prepare("INSERT INTO projects (id, name, save_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
    insertProject.run("legacy-project", "기존 프로젝트", path.join(root, "legacy"), "2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z");
    insertProject.run("newer-project", "다른 프로젝트", path.join(root, "newer"), "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
    legacy.prepare("INSERT INTO prompts (id, project_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("legacy-prompt", "legacy-project", "기존 프롬프트", "이전 내용", "2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z");
  } finally {
    legacy.close();
  }

  try {
    store = new Store(databasePath);
    const projectColumns = store.db.prepare("PRAGMA table_info(projects)").all().map((column) => column.name);
    assert.deepEqual(projectColumns, ["id", "name", "save_path", "external_tracking", "censorship_config", "created_at", "updated_at"]);
    store.savePrompt({ id: "legacy-prompt", projectId: "legacy-project", title: "기존 프롬프트", content: "업데이트 후 수정" });
    assert.equal(store.listProjects()[0].id, "legacy-project");
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("프로젝트, 분류 기준, 규칙과 에셋 정보를 저장한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-store-"));
  let store;
  try {
    store = new Store(path.join(root, "test.sqlite"));
    const project = store.createProject({ name: "테스트", savePath: path.join(root, "assets") });
    const configured = store.saveProject({
      ...project,
      tags: [{ id: "tag-1", name: "분류", values: [{ id: "value-1", label: "표시명", value: "저장값" }] }],
      pathTemplate: "{tag:tag-1}.{extension}"
    });
    assert.equal(configured.tags[0].values[0].label, "표시명");
    assert.equal(configured.tags[0].values[0].value, "저장값");
    store.addAsset({ projectId: project.id, sourceName: "source.png", relativePath: "값.png", savedPath: path.join(root, "assets", "값.png") });
    assert.equal(store.listProjects()[0].assetCount, 1);
    assert.equal(store.listAssets(project.id)[0].relativePath, "값.png");
    const assetId = store.listAssets(project.id)[0].id;
    assert.equal(store.getAsset(assetId).relativePath, "값.png");
    assert.equal(store.getAsset("missing"), null);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("프로젝트별 마크다운 프롬프트를 저장하고 불러온다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-prompts-"));
  let store;
  try {
    store = new Store(path.join(root, "test.sqlite"));
    const project = store.createProject({ name: "테스트", savePath: path.join(root, "assets") });
    const created = store.createPrompt(project.id);
    assert.equal(created.title, "새 프롬프트 01");
    const saved = store.savePrompt({ id: created.id, projectId: project.id, title: "캐릭터 설정", content: "# 주인공\n\n- 밝은 표정" });
    assert.equal(saved.title, "캐릭터 설정");
    assert.equal(saved.content, "# 주인공\n\n- 밝은 표정");
    assert.equal(store.listPrompts(project.id)[0].id, created.id);
    const second = store.createPrompt(project.id);
    store.reorderPrompts(project.id, [second.id, created.id]);
    assert.deepEqual(store.listPrompts(project.id).map((entry) => entry.id), [second.id, created.id]);
    store.deletePrompt(second.id, project.id);
    store.deletePrompt(created.id, project.id);
    assert.equal(store.listPrompts(project.id).length, 0);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("프로젝트별 시작 상황을 저장하고 복제한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-situations-"));
  let store;
  try {
    store = new Store(path.join(root, "test.sqlite"));
    const project = store.createProject({ name: "테스트", savePath: path.join(root, "assets") });
    const created = store.createSituation(project.id);
    assert.equal(created.title, "새 시작 상황 1");
    const saved = store.saveSituation({ id: created.id, projectId: project.id, title: "첫 만남", content: "# 광장\n\n|인물|상태|\n|-|-|\n|주인공|긴장|" });
    const copy = store.duplicateSituation(saved.id, project.id);
    assert.equal(copy.title, "첫 만남 사본");
    assert.equal(copy.content, saved.content);
    assert.equal(store.listSituations(project.id).length, 2);
    store.reorderSituations(project.id, [copy.id, created.id]);
    assert.deepEqual(store.listSituations(project.id).map((entry) => entry.id), [copy.id, created.id]);
    store.deleteSituation(created.id, project.id);
    assert.equal(store.listSituations(project.id).length, 1);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("프로젝트 프롬프트, 시작 상황, 로어북을 종류별 폴더로 관리한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-entry-folders-"));
  let store;
  try {
    store = new Store(path.join(root, "test.sqlite"));
    const project = store.createProject({ name: "테스트", savePath: path.join(root, "assets") });
    const cases = [
      { type: "prompt", create: () => store.createPrompt(project.id), get: (id) => store.getPrompt(id) },
      { type: "situation", create: () => store.createSituation(project.id), get: (id) => store.getSituation(id) },
      { type: "lorebook", create: () => store.createLorebook(project.id), get: (id) => store.getLorebook(id) }
    ];
    for (const item of cases) {
      const entry = item.create();
      const folder = store.createProjectEntryFolder(project.id, item.type, `${item.type} 폴더`);
      const moved = store.moveProjectEntryToFolder(entry.id, project.id, item.type, folder.id);
      assert.equal(moved.folderId, folder.id);
      assert.equal(moved.folderName, `${item.type} 폴더`);
      const renamed = store.renameProjectEntryFolder(folder.id, project.id, item.type, `${item.type} 변경`);
      assert.equal(renamed.name, `${item.type} 변경`);
      assert.equal(item.get(entry.id).folderName, `${item.type} 변경`);
      store.deleteProjectEntryFolder(folder.id, project.id, item.type);
      assert.equal(item.get(entry.id).folderId, "");
    }
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("작품의 캐릭터 성향과 이용자 설정을 저장한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-work-settings-"));
  let store;
  try {
    store = new Store(path.join(root, "test.sqlite"));
    const project = store.createProject({ name: "테스트", savePath: path.join(root, "assets") });
    assert.equal(store.getWork(project.id).characterPreference, "ALL");
    assert.equal(store.getWork(project.id).ageRating, "SAFE");
    const saved = store.saveWork(project.id, "소개", ["판타지"], "FEMALE", "UNSAFE");
    assert.equal(saved.characterPreference, "FEMALE");
    assert.equal(saved.ageRating, "UNSAFE");
    assert.deepEqual(saved.tags, ["판타지"]);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("전역 프롬프트와 로어북 템플릿을 저장한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-templates-"));
  let store;
  try {
    store = new Store(path.join(root, "test.sqlite"));
    const prompt = store.createTemplate("prompt");
    const promptFolder = store.createTemplateFolder("prompt", "플랫폼 프롬프트");
    store.saveTemplate({ id: prompt.id, type: "prompt", title: "범용 프롬프트", folderId: promptFolder.id, content: "# 프롬프트" });
    const secondPrompt = store.createTemplate("prompt");
    store.reorderTemplates("prompt", [secondPrompt.id, prompt.id]);
    assert.deepEqual(store.listTemplates("prompt").map((entry) => entry.id), [secondPrompt.id, prompt.id]);
    const lorebook = store.createTemplate("lorebook");
    const folder = store.createTemplateFolder("lorebook", "판타지");
    const savedLorebook = store.saveTemplate({ id: lorebook.id, type: "lorebook", title: "세계관", folderId: folder.id, keywords: ["왕국"], content: "# 왕국" });
    assert.equal(store.listTemplates("prompt")[1].title, "범용 프롬프트");
    assert.equal(store.listTemplates("prompt")[1].folderName, "플랫폼 프롬프트");
    assert.deepEqual(savedLorebook.keywords, ["왕국"]);
    assert.equal(savedLorebook.folderName, "판타지");
    assert.equal(store.duplicateTemplate(lorebook.id, "lorebook").title, "세계관 사본");
    const situation = store.createTemplate("situation");
    const savedSituation = store.saveTemplate({ id: situation.id, type: "situation", title: "첫 만남", content: "# 광장" });
    assert.equal(savedSituation.content, "# 광장");
    assert.equal(store.listTemplates("situation")[0].title, "첫 만남");
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("프로젝트별 로어북과 활성 키워드를 저장하고 복제한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-lorebooks-"));
  let store;
  try {
    store = new Store(path.join(root, "test.sqlite"));
    const project = store.createProject({ name: "테스트", savePath: path.join(root, "assets") });
    const created = store.createLorebook(project.id);
    const saved = store.saveLorebook({ id: created.id, projectId: project.id, title: "마법학교", keywords: ["마법", "아카데미"], content: "# 학교 설정" });
    assert.deepEqual(saved.keywords, ["마법", "아카데미"]);
    assert.equal(saved.content, "# 학교 설정");
    const copy = store.duplicateLorebook(saved.id, project.id);
    assert.equal(copy.title, "마법학교 사본");
    assert.deepEqual(copy.keywords, saved.keywords);
    assert.equal(store.listLorebooks(project.id).length, 2);
    store.reorderLorebooks(project.id, [copy.id, created.id]);
    assert.deepEqual(store.listLorebooks(project.id).map((entry) => entry.id), [copy.id, created.id]);
    store.deleteLorebook(created.id, project.id);
    assert.equal(store.listLorebooks(project.id).length, 1);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("빈 타이틀 슬롯을 유지하고 이미지 정보만 비울 수 있다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-title-slots-"));
  let store;
  try {
    store = new Store(path.join(root, "test.sqlite"));
    const project = store.createProject({ name: "테스트", savePath: path.join(root, "assets") });
    const first = store.createWorkTitleSlot(project.id);
    assert.equal(first.sourceName, "");
    assert.equal(first.savedPath, "");
    assert.equal(store.setWorkTitleSlotImage(first.id, project.id, "Title001.png", path.join(root, "assets", "Title001.png")), true);
    assert.equal(store.listWorkTitleImages(project.id)[0].sourceName, "Title001.png");
    assert.equal(store.clearWorkTitleSlotImage(first.id, project.id), true);
    assert.equal(store.listWorkTitleImages(project.id)[0].savedPath, "");
    const second = store.createWorkTitleSlot(project.id);
    assert.equal(second.position, 1);
    store.removeWorkTitleImage(first.id, project.id);
    assert.equal(store.listWorkTitleImages(project.id)[0].id, second.id);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
