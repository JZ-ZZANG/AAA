const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { Store } = require("../electron/store.cts");
const { projectRoot, originAssetRoot, cleanedAssetRoot } = require("../electron/project-paths.cts");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-project-activation-"));
  const store = new Store(path.join(root, "test.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const handlers = new Map();
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.cts"), "utf8");
  const context = vm.createContext({
    fs, path, store, originAssetRoot, cleanedAssetRoot,
    PROJECT_EXTENSIONS: new Set([".png", ".jpg", "original"]),
    IMAGE_EXTENSIONS: new Set([".png", ".jpg"]),
    app: { getPath: () => root },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) }
  });
  for (const [startText, endText] of [
    ["function requiredText(", "function stickerRoot("],
    ["function projectFolderName(", "function escapeRegularExpression("],
    ["function findPathRuleCollision(", "async function archiveEntry("],
    ['  ipcMain.handle("projects:create"', '  ipcMain.handle("path-rules:preview"'],
    ['  ipcMain.handle("works:get"', '  ipcMain.handle("works:list-images"'],
    ['  ipcMain.handle("works:add-image"', '  ipcMain.handle("works:delete-image"']
  ]) {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(source.slice(start, end), context);
  }
  return { root, store, call: (name, input) => handlers.get(name)({}, input) };
}

test("이름만으로 프로젝트를 생성하고 에셋 폴더 없이 프로젝트를 저장한다", async (t) => {
  const { root, store, call } = fixture(t);
  const before = fs.readdirSync(root);
  const project = await call("projects:create", { name: "새 프로젝트" });
  assert.equal(project.savePath, "");
  assert.equal(project.censorshipConfig.enabled, false);
  const saved = await call("projects:save", { ...project, name: "수정한 이름" });
  assert.equal(saved.name, "수정한 이름");
  assert.equal(saved.savePath, "");
  assert.deepEqual(fs.readdirSync(root), before);
  assert.equal(store.listProjects().length, 1);
});

test("에셋 위치와 검열 형식을 지정하면 해당 폴더에 에셋 기능을 활성화한다", async (t) => {
  const { root, call } = fixture(t);
  const project = await call("projects:create", { name: "새 프로젝트" });
  const savePath = path.join(root, "assets");
  const tags = [{ id: "character", name: "캐릭터", values: [{ id: "alice", label: "앨리스", value: "Alice" }] }];
  const saved = await call("projects:save", {
    ...project, savePath, tags, pathTemplate: "{tag:character}.{extension}",
    censorshipConfig: { enabled: true, outputExtension: "original" }
  });
  assert.equal(saved.savePath, savePath);
  assert.equal(saved.censorshipConfig.enabled, true);
  assert.equal(saved.censorshipConfig.outputExtension, "original");
  assert.equal(saved.tags[0].values[0].value, "Alice");
  assert.ok(fs.statSync(originAssetRoot(saved)).isDirectory());
  assert.ok(fs.statSync(cleanedAssetRoot(saved)).isDirectory());
});

test("에셋 위치가 없으면 검열을 켜거나 작업 폴더를 에셋 위치로 사용하지 않는다", async (t) => {
  const { call } = fixture(t);
  const project = await call("projects:create", { name: "새 프로젝트", savePath: "  ", censorshipEnabled: true });
  assert.equal(project.censorshipConfig.enabled, false);
  const saved = await call("projects:save", { ...project, censorshipConfig: { enabled: true } });
  assert.equal(saved.censorshipConfig.enabled, false);
  for (const resolve of [projectRoot, originAssetRoot, cleanedAssetRoot]) {
    assert.throws(() => resolve(saved), /에셋 위치를 지정/);
  }
});

test("프로젝트 생성 시 선택한 위치에 프로젝트명을 덧붙이지 않는다", async (t) => {
  const { root, call } = fixture(t);
  const project = await call("projects:create", { name: "기존 방식", savePath: root, censorshipEnabled: true, censorshipExtension: ".jpg" });
  assert.equal(project.savePath, root);
  assert.equal(fs.existsSync(path.join(root, "기존 방식")), false);
  assert.ok(fs.statSync(originAssetRoot(project)).isDirectory());
  assert.ok(fs.statSync(cleanedAssetRoot(project)).isDirectory());
  assert.equal(project.censorshipConfig.outputExtension, ".jpg");
});

test("작품 저장으로 이름을 변경해도 에셋 위치와 분류 및 검열 설정은 유지한다", async (t) => {
  const { root, store, call } = fixture(t);
  const created = await call("projects:create", { name: "이전 이름" });
  const project = await call("projects:save", {
    ...created, savePath: root,
    tags: [{ id: "character", name: "캐릭터", values: [{ id: "alice", label: "앨리스", value: "Alice" }] }],
    pathTemplate: "{tag:character}.{extension}",
    censorshipConfig: { enabled: true, outputExtension: ".png" }
  });
  const work = await call("works:get", project.id);
  assert.equal(work.projectName, "이전 이름");
  const saved = await call("works:save", { ...work, projectName: " 새 이름 ", introduction: "소개 글", tags: ["판타지"] });
  assert.equal(saved.projectName, "새 이름");
  assert.equal(saved.introduction, "소개 글");
  assert.deepEqual(saved.tags, ["판타지"]);
  const renamed = store.getProject(project.id);
  assert.equal(renamed.name, "새 이름");
  assert.equal(renamed.savePath, project.savePath);
  assert.deepEqual(renamed.tags, project.tags);
  assert.equal(renamed.pathTemplate, project.pathTemplate);
  assert.deepEqual(renamed.censorshipConfig, project.censorshipConfig);
  const nameOnly = await call("works:save", { ...saved, projectName: "이름만 수정" });
  assert.equal(nameOnly.projectName, "이름만 수정");
  assert.equal(nameOnly.introduction, "소개 글");
});

test("빈 프로젝트 이름은 기존 이름과 작품 내용을 덮어쓰지 않는다", async (t) => {
  const { store, call } = fixture(t);
  const project = await call("projects:create", { name: "작품" });
  const work = await call("works:save", { projectId: project.id, projectName: "작품", introduction: "기존 소개" });
  assert.throws(() => call("works:save", { ...work, projectName: "  ", introduction: "변경 내용" }), /프로젝트 이름/);
  assert.equal(store.getProject(project.id).name, "작품");
  assert.equal(store.getWork(project.id).introduction, "기존 소개");
  const { projectName, ...withoutName } = work;
  const saved = await call("works:save", { ...withoutName, introduction: "다른 소개" });
  assert.equal(saved.projectName, "작품");
  assert.equal(saved.introduction, "다른 소개");
});

test("에셋 활성화 전 등록한 타이틀 이미지는 활성화 후에도 유지된다", async (t) => {
  const { root, store, call } = fixture(t);
  const project = await call("projects:create", { name: "작품" });
  const slot = store.createWorkTitleSlot(project.id);
  const sourcePath = path.join(root, "source.png");
  fs.writeFileSync(sourcePath, "title-image");
  const image = await call("works:add-image", { projectId: project.id, slotId: slot.id, sourcePath });
  assert.equal(image.savedPath, path.join(root, "projects", project.id, "title_images", "Title001.png"));
  assert.equal(fs.readFileSync(image.savedPath, "utf8"), "title-image");
  await call("projects:save", { ...project, savePath: path.join(root, "assets") });
  const retained = store.listWorkTitleImages(project.id).find((item) => item.id === slot.id);
  assert.equal(retained.savedPath, image.savedPath);
  assert.equal(fs.readFileSync(retained.savedPath, "utf8"), "title-image");
  assert.equal(fs.readFileSync(sourcePath, "utf8"), "title-image");
});
