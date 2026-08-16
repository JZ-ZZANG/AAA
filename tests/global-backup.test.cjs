const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../electron-dist/store.cjs");

test("global backup restore appends settings data without changing projects", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaa-global-backup-"));
  let store;
  try {
    store = new Store(path.join(root, "test.sqlite"));
    const project = store.createProject({ name: "Project", savePath: path.join(root, "assets") });
    store.createPrompt(project.id);

    const folder = store.createTemplateFolder("prompt", "Folder");
    const template = store.createTemplate("prompt");
    store.saveTemplate({ id: template.id, type: "prompt", title: "Template", folderId: folder.id, keywords: [], content: "Body" });
    const backup = store.getGlobalBackupData();
    const result = store.appendGlobalBackupData(backup);

    assert.deepEqual(result, { templates: 1, templateFolders: 1 });
    assert.equal(store.listTemplates("prompt").length, 2);
    assert.equal(store.listTemplateFolders("prompt").length, 2);
    const restoredTemplate = store.listTemplates("prompt").find((entry) => entry.id !== template.id);
    assert.equal(restoredTemplate.title, "Template");
    assert.equal(restoredTemplate.folderName, "Folder");
    assert.notEqual(restoredTemplate.folderId, folder.id);
    assert.equal(store.listProjects().length, 1);
    assert.equal(store.listPrompts(project.id).length, 1);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
