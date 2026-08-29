const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { Store } = require("./store.cjs");
const { copyClassifiedAsset, renderRelativePath, IMAGE_EXTENSIONS, PROJECT_EXTENSIONS } = require("./classification.cjs");
const { scanProjectInventory, refreshTrackedFiles } = require("./external-sync.cjs");
const { createAnimation, saveGeneratedAnimation } = require("./gif.cjs");
const { runAiCensorship } = require("./ai-censorship.cjs");
const { withStagedFileDeletion } = require("./safe-delete.cjs");
const { originAssetRoot, cleanedAssetRoot } = require("./project-paths.cjs");
const { createZip, readArchive, safeArchiveName } = require("./project-archive.cjs");
const { addStickers, deleteSticker, listStickers, stickerPath } = require("./stickers.cjs");
const { AiRuntimeManager } = require("./ai-runtime.cjs");
const { validatedImage, standaloneAssetsFromFiles, scanStandaloneFolder, planStandaloneOutputs } = require("./standalone-ai-censorship.cjs");
const crypto = require("node:crypto");
const sharp = require("sharp");
let electronAutoUpdater = null;
try { ({ autoUpdater: electronAutoUpdater } = require("electron-updater")); } catch {}

// 표시 이름이나 패키징 설정이 바뀌어도 사용자 데이터 위치를 유지한다.
app.setPath("userData", path.join(app.getPath("appData"), "JZ-ZZANG", "AAA"));

protocol.registerSchemesAsPrivileged([
  { scheme: "aaa-asset", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

const STARTUP_LOADING_PAGE = `data:text/html;charset=UTF-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}body{display:grid;place-items:center;background:#f5f5f3}.startup-loader{position:relative;width:220px;height:4px;overflow:hidden;border-radius:999px;background:#deded9}.startup-loader::after{content:"";position:absolute;inset:0;width:42%;border-radius:inherit;background:#555;animation:loading 1.05s ease-in-out infinite}@keyframes loading{0%{transform:translateX(-110%)}100%{transform:translateX(350%)}}@media(prefers-color-scheme:dark){body{background:#1d1d1b}.startup-loader{background:#343432}.startup-loader::after{background:#aaa}}@media(prefers-reduced-motion:reduce){.startup-loader::after{animation-duration:1.8s}}</style></head><body><div class="startup-loader" role="progressbar" aria-label="불러오는 중"></div></body></html>`)}`;

let store;
let aiRuntime;
const censoredSaveQueues = new Map();
let activeAiCensorshipPromise = null;
let activeAiCensorshipController = null;
const aiCensorshipLogs = [];
const MAX_AI_CENSORSHIP_LOGS = 500;
const approvedCloseWindows = new WeakSet();
const gifPreviewPaths = new Map();
const animationPreviewFiles = new Map();
const MAX_GIF_PREVIEW_PATHS = 200;
let updateState = { status: "checking", currentVersion: app.getVersion(), latestVersion: "", percent: 0, message: "" };

function appendAiCensorshipLog(level, message) {
  aiCensorshipLogs.push({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level, message });
  if (aiCensorshipLogs.length > MAX_AI_CENSORSHIP_LOGS) aiCensorshipLogs.splice(0, aiCensorshipLogs.length - MAX_AI_CENSORSHIP_LOGS);
}

function publishAiRuntimeProgress(progress) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("ai-runtime:progress", progress);
  }
}
let updateInstallRequested = false;

function publishUpdateState(changes = {}) {
  updateState = { ...updateState, ...changes };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("updates:state-changed", updateState);
  }
  return updateState;
}

function configureAutoUpdate() {
  if (!app.isPackaged) {
    publishUpdateState({ status: "up-to-date", latestVersion: app.getVersion(), message: "" });
    return;
  }
  if (!electronAutoUpdater) {
    publishUpdateState({ status: "error", message: "업데이트 모듈을 불러오지 못했습니다." });
    return;
  }
  electronAutoUpdater.autoDownload = false;
  electronAutoUpdater.autoInstallOnAppQuit = false;
  electronAutoUpdater.allowPrerelease = false;
  electronAutoUpdater.on("checking-for-update", () => publishUpdateState({ status: "checking", percent: 0, message: "" }));
  electronAutoUpdater.on("update-available", (info) => publishUpdateState({ status: "available", latestVersion: String(info?.version || ""), percent: 0, message: "" }));
  electronAutoUpdater.on("update-not-available", (info) => publishUpdateState({ status: "up-to-date", latestVersion: String(info?.version || app.getVersion()), percent: 0, message: "" }));
  electronAutoUpdater.on("download-progress", (progress) => publishUpdateState({ status: "downloading", percent: Math.max(0, Math.min(100, Number(progress?.percent) || 0)), message: "" }));
  electronAutoUpdater.on("update-downloaded", () => {
    publishUpdateState({ status: "installing", percent: 100, message: "" });
    for (const window of BrowserWindow.getAllWindows()) approvedCloseWindows.add(window);
    setImmediate(() => electronAutoUpdater.quitAndInstall(true, true));
  });
  electronAutoUpdater.on("error", (error) => {
    updateInstallRequested = false;
    publishUpdateState({ status: "error", percent: 0, message: error?.message || "업데이트 중 오류가 발생했습니다." });
  });
  setTimeout(() => electronAutoUpdater.checkForUpdates().catch((error) => publishUpdateState({ status: "error", message: error.message })), 1500);
}

function responseWithCors(body, options: any = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(body, { ...options, headers });
}

function registerGifPreviewPath(imagePath) {
  for (const [token, entry] of gifPreviewPaths) {
    if (entry.imagePath === imagePath) {
      entry.lastAccess = Date.now();
      return token;
    }
  }
  const token = crypto.randomUUID();
  gifPreviewPaths.set(token, { imagePath, lastAccess: Date.now() });
  if (gifPreviewPaths.size > MAX_GIF_PREVIEW_PATHS) {
    const oldest = [...gifPreviewPaths.entries()].sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0]?.[0];
    if (oldest) gifPreviewPaths.delete(oldest);
  }
  return token;
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: "#f5f5f3",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.__aaaApplicationLoaded = false;
  window.on("maximize", () => window.webContents.send("window:maximized-changed", true));
  window.on("unmaximize", () => window.webContents.send("window:maximized-changed", false));
  window.on("close", (event) => {
    if (approvedCloseWindows.has(window) || !window.__aaaApplicationLoaded) return;
    if (updateState.status === "downloading") {
      event.preventDefault();
      window.focus();
      return;
    }
    event.preventDefault();
    window.webContents.send("window:close-requested");
  });
  await window.loadURL(STARTUP_LOADING_PAGE);
  if (!window.isDestroyed()) window.show();
  return window;
}

async function loadApplication(window) {
  if (!window || window.isDestroyed()) return Promise.resolve();
  if (app.isPackaged) await window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  else await window.loadURL("http://localhost:5173");
  if (!window.isDestroyed()) window.__aaaApplicationLoaded = true;
}

function requiredText(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label}을(를) 입력해 주세요.`);
  return text;
}

async function statsOrNull(targetPath) {
  try { return await fs.promises.stat(targetPath); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function stickerRoot() {
  return path.join(app.getPath("userData"), "stickers");
}

function twemojiSvgPath(idValue) {
  const id = typeof idValue === "string" ? idValue.toLowerCase() : "";
  if (!/^[0-9a-f]+(?:-[0-9a-f]+)*$/.test(id)) throw new Error("Twemoji ID가 올바르지 않습니다.");
  const staticRoot = app.isPackaged ? path.join(__dirname, "..", "dist") : path.join(__dirname, "..", "public");
  return path.join(staticRoot, "vendor", "twemoji", "assets", "svg", `${id}.svg`);
}

async function stickerListWithUrls() {
  return (await listStickers(stickerRoot())).map((sticker) => ({
    ...sticker,
    url: `aaa-asset://local/sticker/${encodeURIComponent(sticker.id)}?v=${sticker.modifiedAt}`
  }));
}

function animationDefaultFileName(format, createdAt = new Date()) {
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  const timestamp = `${createdAt.getFullYear()}${pad(createdAt.getMonth() + 1)}${pad(createdAt.getDate())}-${pad(createdAt.getHours())}${pad(createdAt.getMinutes())}${pad(createdAt.getSeconds())}`;
  return `animation-${timestamp}.${format}`;
}

async function discardAnimationPreview(token) {
  const preview = animationPreviewFiles.get(token);
  if (!preview) return false;
  animationPreviewFiles.delete(token);
  await fs.promises.unlink(preview.filePath).catch(() => {});
  return true;
}

function projectFolderName(name) {
  const value = requiredText(name, "프로젝트 이름");
  if (/[<>:"/\\|?*\x00-\x1f]/.test(value) || value === "." || value === ".." || /[. ]$/.test(value)) throw new Error("프로젝트 이름에 폴더명으로 사용할 수 없는 문자가 있습니다.");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)) throw new Error("프로젝트 이름을 폴더명으로 사용할 수 없습니다.");
  return value;
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assetMatchesProjectRule(project, asset) {
  if (!project.pathTemplate || !project.tags.length) return false;
  let pattern = escapeRegularExpression(project.pathTemplate.replaceAll("\\", "/"));
  for (const tag of project.tags) {
    const values = tag.values.map((item) => escapeRegularExpression(item.value.replaceAll("\\", "/")));
    if (!values.length) return false;
    pattern = pattern.replaceAll(escapeRegularExpression(`{tag:${tag.id}}`), `(?:${values.join("|")})`);
  }
  pattern = pattern.replaceAll(escapeRegularExpression("{extension}"), "(?:png|jpe?g|webp|avif|gif|bmp)");
  return new RegExp(`^${pattern}$`, "i").test(asset.relativePath.replaceAll("\\", "/"));
}

function censorshipOutputExtension(project, assetPath) {
  if (project.censorshipConfig.outputExtension === "original") {
    const sourceExtension = path.extname(assetPath).toLowerCase();
    return PROJECT_EXTENSIONS.has(sourceExtension) ? sourceExtension : ".png";
  }
  return PROJECT_EXTENSIONS.has(project.censorshipConfig.outputExtension) ? project.censorshipConfig.outputExtension : ".png";
}

async function ensureCensorshipCopy(project, asset, overwrite = false) {
  if (!project.censorshipConfig.enabled || !assetMatchesProjectRule(project, asset)) return asset;
  const sourceStats = await statsOrNull(asset.savedPath);
  if (!sourceStats?.isFile()) return asset;
  const outputRoot = cleanedAssetRoot(project);
  const outputExtension = censorshipOutputExtension(project, asset.savedPath);
  const relativeOutputPath = asset.relativePath.replace(/\.[^./\\]+$/, outputExtension);
  const outputPath = path.join(outputRoot, relativeOutputPath);
  if (!overwrite && await statsOrNull(asset.cleanedPath || outputPath)) return asset;
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const sourceExtension = path.extname(asset.savedPath).toLowerCase();
  const sameFormat = sourceExtension === outputExtension || [sourceExtension, outputExtension].every((extension) => extension === ".jpg" || extension === ".jpeg");
  if (sameFormat) await fs.promises.copyFile(asset.savedPath, outputPath);
  else await require("sharp")(asset.savedPath, { animated: true }).toFormat(outputExtension.slice(1) === "jpg" ? "jpeg" : outputExtension.slice(1)).toFile(outputPath);
  store.setAssetReview(asset.id, "unreviewed", outputPath);
  return { ...asset, reviewStatus: "unreviewed", cleanedPath: outputPath };
}

function findPathRuleCollision(tags, pathTemplate) {
  const tagIds = [...new Set([...pathTemplate.matchAll(/\{tag:([^}]+)\}/g)].map((match) => match[1]))];
  const referencedTags = tagIds.map((id) => tags.find((tag) => tag.id === id)).filter(Boolean);
  const seen = new Map();
  let collision = null;
  const visit = (index, rendered, selections) => {
    if (collision) return;
    if (index >= referencedTags.length) {
      const finalPath = rendered.replaceAll("{extension}", "png").replaceAll("\\", "/").replace(/\/+/g, "/");
      const key = finalPath.toLowerCase();
      const previous = seen.get(key);
      if (previous) collision = { path: finalPath, first: previous, second: selections };
      else seen.set(key, selections);
      return;
    }
    const tag = referencedTags[index];
    for (const option of tag.values) {
      visit(index + 1, rendered.replaceAll(`{tag:${tag.id}}`, option.value), [...selections, `${tag.name}=${option.label}`]);
    }
  };
  visit(0, pathTemplate, []);
  return collision;
}

function validateProjectConfig(input) {
  const id = requiredText(input?.id, "프로젝트 ID");
  const name = requiredText(input?.name, "프로젝트 이름");
  const savePath = path.resolve(requiredText(input?.savePath, "저장 위치"));
  if (!Array.isArray(input?.tags)) throw new Error("분류 기준 형식이 올바르지 않습니다.");
  const names = new Set();
  const tags = input.tags.map((tag) => {
    const tagName = requiredText(tag?.name, "분류 기준 이름");
    if (names.has(tagName)) throw new Error("분류 기준 이름은 중복될 수 없습니다.");
    names.add(tagName);
    if (!Array.isArray(tag.values) || !tag.values.length) throw new Error(`${tagName}에 값을 하나 이상 추가해 주세요.`);
    const labels = new Set();
    const valuesSeen = new Set();
    const values = tag.values.map((item) => {
      const label = requiredText(item?.label, `${tagName} 표시명`);
      if (typeof item?.value !== "string") throw new Error(`${tagName} 값 형식이 올바르지 않습니다.`);
      const value = item.value.trim();
      if (labels.has(label)) throw new Error(`${tagName}에 중복된 키가 있습니다: ${label}`);
      if (valuesSeen.has(value)) throw new Error(`${tagName}에 중복된 값이 있습니다: ${value}`);
      labels.add(label);
      valuesSeen.add(value);
      return { id: requiredText(item?.id, "분류 값 ID"), label, value };
    });
    return { id: requiredText(tag?.id, "분류 기준 ID"), name: tagName, values };
  });
  const pathTemplate = typeof input?.pathTemplate === "string" ? input.pathTemplate.trim() : "";
  const externalTracking = input?.externalTracking === true;
  const validTagIds = new Set(tags.map((tag) => tag.id));
  if (pathTemplate) {
    const references = [...pathTemplate.matchAll(/\{tag:([^}]+)\}/g)].map((match) => match[1]);
    if (references.some((tagId) => !validTagIds.has(tagId))) throw new Error("삭제된 분류 기준이 저장 규칙에 남아 있습니다.");
    if (!pathTemplate.endsWith(".{extension}")) throw new Error("저장 규칙은 고정 확장자로 끝나야 합니다.");
    const withoutTokens = pathTemplate.replace(/\{tag:[^}]+\}/g, "").replaceAll("{extension}", "");
    if (/[{}]/.test(withoutTokens)) throw new Error("저장 규칙에 알 수 없는 항목이 있습니다.");
    const collision = findPathRuleCollision(tags, pathTemplate);
    if (collision) throw new Error(`에셋 저장 규칙에서 서로 다른 조합이 같은 경로를 만듭니다: ${collision.path} (${collision.first.join(", ")} / ${collision.second.join(", ")})`);
  }
  const censorshipConfig = input?.censorshipConfig && typeof input.censorshipConfig === "object" ? input.censorshipConfig : {};
  censorshipConfig.enabled = censorshipConfig.enabled === true;
  delete censorshipConfig.outputPath;
  return { id, name, savePath, tags, pathTemplate, externalTracking, censorshipConfig };
}

async function archiveEntry(entries, name, filePath) {
  if (filePath && (await statsOrNull(filePath))?.isFile()) {
    entries.push({ name: safeArchiveName(name), data: await fs.promises.readFile(filePath) });
    return name;
  }
  return "";
}

async function buildProjectArchive(project) {
  const entries = [];
  const prompts = store.listPrompts(project.id).map((item) => store.getPrompt(item.id));
  const situations = store.listSituations(project.id).map((item) => store.getSituation(item.id));
  const lorebooks = store.listLorebooks(project.id);
  const titleImages = [];
  for (const image of store.listWorkTitleImages(project.id)) {
    const archivePath = image.savedPath ? `files/title/${safeArchiveName(path.basename(image.savedPath))}` : "";
    titleImages.push({ sourceName: image.sourceName, archivePath: await archiveEntry(entries, archivePath, image.savedPath) });
  }
  const assets = [];
  for (const asset of store.listAssets(project.id)) {
    const relative = safeArchiveName(asset.relativePath);
    const originalPath = await archiveEntry(entries, `files/origin/${relative}`, asset.savedPath);
    if (!originalPath) continue;
    const cleanedName = asset.cleanedPath ? `files/cleaned/${safeArchiveName(asset.relativePath.replace(/\.[^./\\]+$/, path.extname(asset.cleanedPath)))}` : "";
    const cleanedPath = cleanedName ? await archiveEntry(entries, cleanedName, asset.cleanedPath) : "";
    assets.push({ sourceName: asset.sourceName, relativePath: asset.relativePath, reviewStatus: cleanedPath ? asset.reviewStatus : "unreviewed", originalPath, cleanedPath });
  }
  const censorshipConfig = { ...project.censorshipConfig };
  delete censorshipConfig.outputPath;
  delete censorshipConfig.modelPath;
  const folders = {
    prompts: store.listProjectEntryFolders(project.id, "prompt").map(({ id, name, position }) => ({ id, name, position })),
    situations: store.listProjectEntryFolders(project.id, "situation").map(({ id, name, position }) => ({ id, name, position })),
    lorebooks: store.listProjectEntryFolders(project.id, "lorebook").map(({ id, name, position }) => ({ id, name, position }))
  };
  const manifest = {
    format: "aaa-project", version: 1,
    project: { name: project.name, tags: project.tags, pathTemplate: project.pathTemplate, censorshipConfig },
    prompts, lorebooks, situations, folders, work: store.getWork(project.id), titleImages, assets
  };
  entries.unshift({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") });
  return createZip(entries);
}

function archiveManifest(entries) {
  const source = entries.get("manifest.json");
  if (!source) throw new Error("프로젝트 정보가 없는 압축파일입니다.");
  let manifest;
  try { manifest = JSON.parse(source.toString("utf8")); } catch { throw new Error("프로젝트 정보 파일이 손상되었습니다."); }
  if (manifest?.format !== "aaa-project" || manifest?.version !== 1 || !manifest.project) throw new Error("지원하지 않는 프로젝트 압축파일입니다.");
  projectFolderName(manifest.project.name);
  return manifest;
}

async function restoreProjectArchive(archivePath, parentPathValue) {
  const entries = await readArchive(path.resolve(requiredText(archivePath, "프로젝트 압축파일")));
  const manifest = archiveManifest(entries);
  const name = projectFolderName(manifest.project.name);
  const parentPath = path.resolve(requiredText(parentPathValue, "저장 위치"));
  const savePath = path.resolve(parentPath, name);
  if (path.dirname(savePath).toLowerCase() !== parentPath.toLowerCase()) throw new Error("프로젝트 저장 경로가 올바르지 않습니다.");
  const existing = await statsOrNull(savePath);
  if (existing && (!existing.isDirectory() || (await fs.promises.readdir(savePath)).length)) throw new Error("같은 이름의 비어 있지 않은 폴더가 이미 있습니다.");
  const writeEntry = async (archiveName, destination) => {
    if (!archiveName) return "";
    const data = entries.get(safeArchiveName(archiveName));
    if (!data) throw new Error(`압축파일에서 파일을 찾을 수 없습니다: ${archiveName}`);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.writeFile(destination, data, { flag: "wx" });
    return destination;
  };
  let createdProject = null;
  try {
    await fs.promises.mkdir(originAssetRoot({ savePath }), { recursive: true });
    if (manifest.project.censorshipConfig?.enabled === true) await fs.promises.mkdir(cleanedAssetRoot({ savePath }), { recursive: true });
    const tagIds = new Map();
    const tags = (Array.isArray(manifest.project.tags) ? manifest.project.tags : []).map((tag) => {
      const id = crypto.randomUUID(); tagIds.set(tag.id, id);
      return { id, name: tag.name, values: (tag.values || []).map((value) => ({ id: crypto.randomUUID(), label: value.label, value: value.value })) };
    });
    let pathTemplate = String(manifest.project.pathTemplate || "");
    tagIds.forEach((next, previous) => { pathTemplate = pathTemplate.replaceAll(`{tag:${previous}}`, `{tag:${next}}`); });
    createdProject = store.createProject({ name, savePath, censorshipConfig: manifest.project.censorshipConfig || {} });
    store.saveProject(validateProjectConfig({ ...createdProject, tags, pathTemplate, externalTracking: false, censorshipConfig: manifest.project.censorshipConfig || {} }));
    const restoreFolders = (items, type) => {
      const ids = new Map();
      for (const item of Array.isArray(items) ? items : []) {
        const folder = store.createProjectEntryFolder(createdProject.id, type, String(item?.name || "").trim() || "새 폴더");
        ids.set(item.id, folder.id);
      }
      return ids;
    };
    const promptFolderIds = restoreFolders(manifest.folders?.prompts, "prompt");
    const situationFolderIds = restoreFolders(manifest.folders?.situations, "situation");
    const lorebookFolderIds = restoreFolders(manifest.folders?.lorebooks, "lorebook");
    for (const item of manifest.prompts || []) {
      const created = store.createPrompt(createdProject.id);
      store.savePrompt({ id: created.id, projectId: createdProject.id, title: item.title, content: item.content || "" });
      if (promptFolderIds.has(item.folderId)) store.moveProjectEntryToFolder(created.id, createdProject.id, "prompt", promptFolderIds.get(item.folderId));
    }
    for (const item of manifest.situations || []) {
      const created = store.createSituation(createdProject.id);
      store.saveSituation({ id: created.id, projectId: createdProject.id, title: item.title, content: item.content || "" });
      if (situationFolderIds.has(item.folderId)) store.moveProjectEntryToFolder(created.id, createdProject.id, "situation", situationFolderIds.get(item.folderId));
    }
    for (const item of manifest.lorebooks || []) {
      const created = store.createLorebook(createdProject.id);
      store.saveLorebook({ id: created.id, projectId: createdProject.id, title: item.title, keywords: item.keywords || [], content: item.content || "" });
      if (lorebookFolderIds.has(item.folderId)) store.moveProjectEntryToFolder(created.id, createdProject.id, "lorebook", lorebookFolderIds.get(item.folderId));
    }
    store.saveWork(createdProject.id, manifest.work?.introduction || "", Array.isArray(manifest.work?.tags) ? manifest.work.tags : [], ["ALL", "MALE", "FEMALE"].includes(manifest.work?.characterPreference) ? manifest.work.characterPreference : "ALL", ["SAFE", "UNSAFE"].includes(manifest.work?.ageRating) ? manifest.work.ageRating : "SAFE");
    for (let index = 0; index < (manifest.titleImages || []).length; index += 1) {
      const item = manifest.titleImages[index];
      const slot = store.createWorkTitleSlot(createdProject.id);
      if (item.archivePath) {
        const destination = path.join(savePath, `Title${String(index + 1).padStart(3, "0")}${path.extname(item.sourceName || item.archivePath).toLowerCase()}`);
        await writeEntry(item.archivePath, destination);
        store.setWorkTitleSlotImage(slot.id, createdProject.id, path.basename(destination), destination);
      }
    }
    for (const item of manifest.assets || []) {
      const relativePath = safeArchiveName(item.relativePath).replaceAll("/", path.sep);
      const originalPath = path.join(originAssetRoot({ savePath }), relativePath);
      await writeEntry(item.originalPath, originalPath);
      const stats = await fs.promises.stat(originalPath);
      const asset = store.addAsset({ projectId: createdProject.id, sourceName: item.sourceName || path.basename(originalPath), relativePath, savedPath: originalPath, fileSize: stats.size, modifiedAt: stats.mtimeMs });
      if (item.cleanedPath) {
        const cleanedRelative = safeArchiveName(item.cleanedPath.replace(/^files[\\/]cleaned[\\/]/, "")).replaceAll("/", path.sep);
        const cleanedPath = path.join(cleanedAssetRoot({ savePath }), cleanedRelative);
        await writeEntry(item.cleanedPath, cleanedPath);
        store.setAssetReview(asset.id, ["auto", "manual"].includes(item.reviewStatus) ? item.reviewStatus : "unreviewed", cleanedPath);
      }
    }
    return store.getProject(createdProject.id);
  } catch (error) {
    if (createdProject) store.deleteProject(createdProject.id);
    await fs.promises.rm(savePath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

const GLOBAL_BACKUP_FORMAT = "aaa-global-settings";
const GLOBAL_BACKUP_VERSION = 1;
const MAX_GLOBAL_BACKUP_BYTES = 10 * 1024 * 1024;

function backupObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value;
}

function backupArray(value, label, maximum) {
  if (!Array.isArray(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  if (value.length > maximum) throw new Error(`${label} 항목이 너무 많습니다.`);
  return value;
}

function backupString(value, label, maximum, allowEmpty = true) {
  if (typeof value !== "string") throw new Error(`${label} 형식이 올바르지 않습니다.`);
  if (!allowEmpty && !value.trim()) throw new Error(`${label} 값이 비어 있습니다.`);
  if (value.length > maximum) throw new Error(`${label} 값이 너무 깁니다.`);
  return value;
}

function backupJsonValue(value, label, maximumBytes) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw new Error(`${label} 형식이 올바르지 않습니다.`); }
  if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > maximumBytes) throw new Error(`${label} 데이터가 너무 큽니다.`);
  return JSON.parse(serialized);
}

function normalizeGlobalBackup(payload) {
  const root = backupObject(payload, "백업 파일");
  if (root.format !== GLOBAL_BACKUP_FORMAT || root.formatVersion !== GLOBAL_BACKUP_VERSION) throw new Error("지원하지 않는 AAA 설정 백업 파일입니다.");
  const rawData = backupObject(root.data, "백업 데이터");
  const validTypes = new Set(["prompt", "situation", "lorebook"]);
  const folderKeys = new Set();
  const templateFolders = backupArray(rawData.templateFolders, "템플릿 폴더", 5000).map((raw, index) => {
    const item = backupObject(raw, `템플릿 폴더 ${index + 1}`);
    const id = backupString(item.id, `템플릿 폴더 ${index + 1} ID`, 200, false);
    const type = backupString(item.type, `템플릿 폴더 ${index + 1} 종류`, 20, false);
    if (!validTypes.has(type)) throw new Error(`템플릿 폴더 ${index + 1} 종류가 올바르지 않습니다.`);
    const key = `${type}:${id}`;
    if (folderKeys.has(key)) throw new Error("백업 파일에 중복된 템플릿 폴더가 있습니다.");
    folderKeys.add(key);
    return { id, type, name: backupString(item.name, `템플릿 폴더 ${index + 1} 이름`, 500, false) };
  });
  const templates = backupArray(rawData.templates, "템플릿", 10000).map((raw, index) => {
    const item = backupObject(raw, `템플릿 ${index + 1}`);
    const type = backupString(item.type, `템플릿 ${index + 1} 종류`, 20, false);
    if (!validTypes.has(type)) throw new Error(`템플릿 ${index + 1} 종류가 올바르지 않습니다.`);
    return {
      type,
      title: backupString(item.title, `템플릿 ${index + 1} 제목`, 500, false),
      folderId: backupString(item.folderId || "", `템플릿 ${index + 1} 폴더 ID`, 200),
      keywords: backupArray(item.keywords, `템플릿 ${index + 1} 키워드`, 1000).map((keyword, keywordIndex) => backupString(keyword, `템플릿 ${index + 1} 키워드 ${keywordIndex + 1}`, 500)),
      content: backupString(item.content, `템플릿 ${index + 1} 내용`, 4 * 1024 * 1024)
    };
  });
  return {
    preferences: backupJsonValue(backupObject(root.preferences, "전역 설정"), "전역 설정", 1024 * 1024),
    data: { templates, templateFolders }
  };
}

function globalBackupSummary(data) {
  return {
    templates: data.templates.length,
    templateFolders: data.templateFolders.length
  };
}

function createGlobalBackupPayload(preferences, exportedAt = new Date().toISOString()) {
  return {
    format: GLOBAL_BACKUP_FORMAT,
    formatVersion: GLOBAL_BACKUP_VERSION,
    appVersion: app.getVersion(),
    exportedAt,
    preferences,
    data: store.getGlobalBackupData()
  };
}

function backupTimestamp(createdAt = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${createdAt.getFullYear()}${pad(createdAt.getMonth() + 1)}${pad(createdAt.getDate())}-${pad(createdAt.getHours())}${pad(createdAt.getMinutes())}${pad(createdAt.getSeconds())}`;
}

function fullBackupFolderName(createdAt = new Date()) {
  return `AAA-Backup-${backupTimestamp(createdAt)}`;
}

async function createUniqueBackupFolder(parentPath) {
  const baseName = fullBackupFolderName();
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const folderName = suffix ? `${baseName}-${suffix + 1}` : baseName;
    const candidate = path.join(parentPath, folderName);
    try {
      await fs.promises.mkdir(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("백업 폴더 이름을 만들 수 없습니다.");
}

function uniqueProjectArchiveName(projectName, usedNames) {
  let archiveName = `${projectName}.zip`;
  let suffix = 2;
  while (usedNames.has(archiveName.toLowerCase())) {
    archiveName = `${projectName} (${suffix}).zip`;
    suffix += 1;
  }
  usedNames.add(archiveName.toLowerCase());
  return archiveName;
}

function registerIpc() {
  ipcMain.handle("shell:open-external", (_event, url) => {
    const allowedUrls = new Set([
      "https://github.com/JZ-ZZANG/AAA",
      "https://discord.gg/hq4fvU5UGx"
    ]);
    if (!allowedUrls.has(url)) throw new Error("허용되지 않은 외부 주소입니다.");
    return shell.openExternal(url);
  });
  ipcMain.handle("data:backup", async (_event, input) => {
    const preferences = backupJsonValue(backupObject(input?.preferences, "전역 설정"), "전역 설정", 1024 * 1024);
    const exportedAt = new Date().toISOString();
    const result = await dialog.showSaveDialog({
      title: "설정 백업 저장",
      defaultPath: `AAA-settings-${backupTimestamp(new Date(exportedAt))}.json`,
      filters: [{ name: "AAA 설정 백업", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const payload = createGlobalBackupPayload(preferences, exportedAt);
    await fs.promises.writeFile(result.filePath, JSON.stringify(payload, null, 2), "utf8");
    return { canceled: false, filePath: result.filePath, summary: globalBackupSummary(payload.data) };
  });
  ipcMain.handle("data:full-backup", async (event, input) => {
    const preferences = backupJsonValue(backupObject(input?.preferences, "전역 설정"), "전역 설정", 1024 * 1024);
    const selection = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: "전체 백업을 저장할 위치",
      properties: ["openDirectory", "createDirectory"]
    });
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
    const parentPath = path.resolve(selection.filePaths[0]);
    const outputPath = await createUniqueBackupFolder(parentPath);
    const projects = store.listProjects();
    const failures = [];
    let succeeded = 0;
    await fs.promises.writeFile(path.join(outputPath, "settings.json"), JSON.stringify(createGlobalBackupPayload(preferences), null, 2), "utf8");
    const usedNames = new Set();
    for (let index = 0; index < projects.length; index += 1) {
      const project = projects[index];
      try {
        const archiveName = uniqueProjectArchiveName(project.name, usedNames);
        await fs.promises.writeFile(path.join(outputPath, archiveName), await buildProjectArchive(project), { flag: "wx" });
        succeeded += 1;
      } catch (error) {
        failures.push({ name: project.name, message: error?.message || "백업하지 못했습니다." });
      }
    }
    return { canceled: false, outputPath, total: projects.length, succeeded, failures };
  });
  ipcMain.handle("data:restore", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(owner, {
      title: "설정 백업 선택",
      properties: ["openFile"],
      filters: [{ name: "AAA 설정 백업", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile() || stats.size > MAX_GLOBAL_BACKUP_BYTES) throw new Error("백업 파일이 없거나 크기가 10MB를 초과합니다.");
    let parsed;
    try { parsed = JSON.parse(await fs.promises.readFile(filePath, "utf8")); }
    catch { throw new Error("백업 파일을 읽을 수 없거나 JSON 형식이 올바르지 않습니다."); }
    const backup = normalizeGlobalBackup(parsed);
    const summary = globalBackupSummary(backup.data);
    store.appendGlobalBackupData(backup.data);
    return { canceled: false, preferences: backup.preferences, summary };
  });
  ipcMain.handle("updates:get-state", () => updateState);
  ipcMain.handle("updates:check", async () => {
    if (!app.isPackaged) return publishUpdateState({ status: "up-to-date", latestVersion: app.getVersion(), percent: 0, message: "" });
    if (!electronAutoUpdater) return publishUpdateState({ status: "error", message: "업데이트 모듈을 불러오지 못했습니다." });
    if (["checking", "downloading", "installing"].includes(updateState.status)) return updateState;
    publishUpdateState({ status: "checking", percent: 0, message: "" });
    try {
      await electronAutoUpdater.checkForUpdates();
      return updateState;
    } catch (error) {
      return publishUpdateState({ status: "error", percent: 0, message: error.message });
    }
  });
  ipcMain.handle("updates:install", async () => {
    if (!app.isPackaged || !electronAutoUpdater) throw new Error("설치된 앱에서만 업데이트할 수 있습니다.");
    if (updateState.status !== "available" || updateInstallRequested) return updateState;
    updateInstallRequested = true;
    publishUpdateState({ status: "downloading", percent: 0, message: "" });
    try {
      await electronAutoUpdater.downloadUpdate();
      return updateState;
    } catch (error) {
      updateInstallRequested = false;
      publishUpdateState({ status: "error", percent: 0, message: error.message });
      throw error;
    }
  });
  ipcMain.handle("dialog:choose-directory", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("dialog:choose-model", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "PyTorch 모델", extensions: ["pt"] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("standalone-ai:choose-files", async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { properties: ["openFile", "multiSelections"], filters: [{ name: "이미지", extensions: ["png", "jpg", "jpeg", "webp", "avif", "gif", "bmp"] }] });
    if (result.canceled) return null;
    const assets = await standaloneAssetsFromFiles(result.filePaths);
    return { sourceLabel: assets.length === 1 ? assets[0].savedPath : `${path.dirname(assets[0].savedPath)} 외`, files: assets.map(({ savedPath, relativePath, fileSize }) => ({ sourcePath: savedPath, relativePath, fileSize })) };
  });
  ipcMain.handle("standalone-ai:choose-folder", async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { properties: ["openDirectory"] });
    if (result.canceled) return null;
    const selected = await scanStandaloneFolder(result.filePaths[0]);
    return { sourceLabel: selected.rootPath, files: selected.assets.map(({ savedPath, relativePath, fileSize }) => ({ sourcePath: savedPath, relativePath, fileSize })) };
  });
  ipcMain.handle("ai-runtime:status", () => aiRuntime.installed());
  ipcMain.handle("ai-runtime:check", () => aiRuntime.latest());
  ipcMain.handle("ai-runtime:consume-install-request", () => aiRuntime.consumeInstallRequest());
  ipcMain.handle("ai-runtime:install", () => aiRuntime.installLatest(publishAiRuntimeProgress));
  ipcMain.handle("ai-runtime:install-from-file", async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: "AI 검열 기능 파일 선택",
      properties: ["openFile"],
      filters: [{ name: "AAA AI Runtime", extensions: ["zip"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true, ...(await aiRuntime.installed()) };
    const installed = await aiRuntime.installArchive(result.filePaths[0], publishAiRuntimeProgress);
    return { canceled: false, ...installed };
  });
  ipcMain.handle("ai-runtime:cancel-install", () => { aiRuntime.cancelInstall(); return true; });
  ipcMain.handle("ai-runtime:remove", async () => {
    if (activeAiCensorshipPromise) throw new Error("AI 검열 작업 중에는 실행 환경을 삭제할 수 없습니다.");
    return aiRuntime.remove();
  });
  ipcMain.handle("ai-runtime:open-folder", async () => {
    await fs.promises.mkdir(aiRuntime.rootPath, { recursive: true });
    const error = await shell.openPath(aiRuntime.rootPath);
    if (error) throw new Error(error);
    return true;
  });
  ipcMain.handle("stickers:list", () => stickerListWithUrls());
  ipcMain.handle("stickers:add", async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: "스티커 이미지 추가",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "스티커 이미지", extensions: ["png", "jpg", "jpeg", "webp", "avif", "gif", "bmp", "svg"] }]
    });
    if (result.canceled || !result.filePaths.length) return stickerListWithUrls();
    await addStickers(stickerRoot(), result.filePaths);
    return stickerListWithUrls();
  });
  ipcMain.handle("stickers:delete", async (_event, id) => {
    await deleteSticker(stickerRoot(), id);
    return stickerListWithUrls();
  });
  ipcMain.handle("gifs:choose-images", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: "이미지", extensions: ["png", "jpg", "jpeg", "webp", "avif", "gif", "bmp"] }] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("gifs:preview-url", (_event, imagePathValue) => {
    const imagePath = path.resolve(requiredText(imagePathValue, "이미지 경로"));
    if (!IMAGE_EXTENSIONS.has(path.extname(imagePath).toLowerCase()) || !fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) throw new Error("미리 볼 이미지 파일을 찾을 수 없습니다.");
    const token = registerGifPreviewPath(imagePath);
    return `aaa-asset://local/gif-preview/${token}?v=${fs.statSync(imagePath).mtimeMs}`;
  });
  ipcMain.handle("gifs:create-preview", async (_event, input) => {
    const format = input?.format === "gif" ? "gif" : "webp";
    const token = crypto.randomUUID();
    const filePath = path.join(app.getPath("temp"), `aaa-animation-preview-${process.pid}-${token}.${format}`);
    try {
      const result = await createAnimation({ tracks: input?.tracks, format, quality: input?.quality }, filePath);
      const rawBytes = result.width * result.height * 4 * result.frames;
      animationPreviewFiles.set(token, { filePath, format, createdAt: new Date(), result, tracks: input?.tracks });
      return { token, url: `aaa-asset://local/gif-result/${token}?v=${Date.now()}`, previewable: rawBytes <= 256 * 1024 * 1024, rawBytes, fileSize: fs.statSync(filePath).size, ...result, outputPath: undefined };
    } catch (error) {
      await fs.promises.unlink(filePath).catch(() => {});
      throw error;
    }
  });
  ipcMain.handle("gifs:update-preview", async (_event, tokenValue, settings) => {
    const token = requiredText(tokenValue, "미리보기 ID");
    const preview = animationPreviewFiles.get(token);
    if (!preview || !fs.existsSync(preview.filePath)) throw new Error("변경할 움짤 미리보기를 찾을 수 없습니다.");
    const quality = Math.max(1, Math.min(100, Math.round(Number(settings?.quality) || 100)));
    const format = settings?.format === "gif" ? "gif" : "webp";
    const nextPath = path.join(app.getPath("temp"), `aaa-animation-preview-${process.pid}-${crypto.randomUUID()}.${format}`);
    try {
      const result = await createAnimation({ tracks: preview.tracks, format, quality }, nextPath);
      const previousPath = preview.filePath;
      preview.filePath = nextPath;
      preview.format = format;
      preview.result = result;
      await fs.promises.unlink(previousPath).catch(() => {});
      const rawBytes = result.width * result.height * 4 * result.frames;
      return { token, url: `aaa-asset://local/gif-result/${token}?v=${Date.now()}`, previewable: rawBytes <= 256 * 1024 * 1024, rawBytes, fileSize: fs.statSync(nextPath).size, ...result, outputPath: undefined };
    } catch (error) {
      await fs.promises.unlink(nextPath).catch(() => {});
      throw error;
    }
  });
  ipcMain.handle("gifs:save-preview", async (_event, tokenValue) => {
    const token = requiredText(tokenValue, "미리보기 ID");
    const preview = animationPreviewFiles.get(token);
    if (!preview || !fs.existsSync(preview.filePath)) throw new Error("저장할 움짤 미리보기를 찾을 수 없습니다.");
    const result = await dialog.showSaveDialog({ defaultPath: animationDefaultFileName(preview.format, preview.createdAt), filters: [{ name: preview.format.toUpperCase(), extensions: [preview.format] }] });
    if (result.canceled || !result.filePath) return null;
    const outputPath = path.extname(result.filePath).toLowerCase() === `.${preview.format}` ? result.filePath : `${result.filePath}.${preview.format}`;
    await saveGeneratedAnimation(preview.filePath, outputPath);
    await discardAnimationPreview(token);
    return { ...preview.result, outputPath };
  });
  ipcMain.handle("gifs:discard-preview", (_event, token) => discardAnimationPreview(requiredText(token, "미리보기 ID")));
  ipcMain.handle("shell:open-directory", async (_event, directoryPath) => {
    const resolved = path.resolve(requiredText(directoryPath, "폴더 위치"));
    if (!(await statsOrNull(resolved))?.isDirectory()) throw new Error("폴더를 찾을 수 없습니다.");
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
    return true;
  });
  ipcMain.handle("markdown:image-data-url", async (_event, source, basePath) => {
    const imageSource = requiredText(source, "이미지 경로");
    let localSource = imageSource;
    try { localSource = decodeURIComponent(imageSource); } catch {}
    let imagePath;
    if (/^file:\/\//i.test(localSource)) imagePath = fileURLToPath(localSource);
    else if (path.isAbsolute(localSource)) imagePath = path.resolve(localSource);
    else imagePath = path.resolve(requiredText(basePath, "프로젝트 저장 위치"), localSource.replaceAll("/", path.sep));
    const extension = path.extname(imagePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) throw new Error("지원하지 않는 이미지 형식입니다.");
    if (!(await statsOrNull(imagePath))?.isFile()) throw new Error("이미지 파일을 찾을 수 없습니다.");
    const mimeTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".bmp": "image/bmp" };
    return `data:${mimeTypes[extension]};base64,${(await fs.promises.readFile(imagePath)).toString("base64")}`;
  });
  ipcMain.handle("projects:list", () => store.listProjects().map((project) => {
    const titleImage = store.listWorkTitleImages(project.id).find((image) => image.savedPath) || null;
    return { ...project, titleImage: titleImage ? { id: titleImage.id, createdAt: titleImage.createdAt } : null };
  }));
  ipcMain.handle("projects:get", (_event, id) => store.getProject(requiredText(id, "프로젝트 ID")));
  ipcMain.handle("projects:choose-archive", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "AAA 프로젝트", extensions: ["zip"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const manifest = archiveManifest(await readArchive(result.filePaths[0]));
    return { archivePath: result.filePaths[0], name: manifest.project.name };
  });
  ipcMain.handle("projects:restore", (_event, input) => restoreProjectArchive(input?.archivePath, input?.savePath));
  ipcMain.handle("projects:export", async (_event, projectId) => {
    const project = store.getProject(requiredText(projectId, "프로젝트 ID"));
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    const result = await dialog.showSaveDialog({ defaultPath: `${project.name}.zip`, filters: [{ name: "AAA 프로젝트", extensions: ["zip"] }] });
    if (result.canceled || !result.filePath) return null;
    const outputPath = path.extname(result.filePath).toLowerCase() === ".zip" ? result.filePath : `${result.filePath}.zip`;
    await fs.promises.writeFile(outputPath, await buildProjectArchive(project));
    return outputPath;
  });
  ipcMain.handle("projects:create", async (_event, input) => {
    const name = projectFolderName(input?.name);
    const parentPath = path.resolve(requiredText(input?.savePath, "저장 위치"));
    const savePath = path.join(parentPath, name);
    const existing = await statsOrNull(savePath);
    if (existing && (!existing.isDirectory() || (await fs.promises.readdir(savePath)).length)) throw new Error("같은 이름의 비어 있지 않은 폴더가 이미 있습니다.");
    const censorshipConfig = {
      enabled: input?.censorshipEnabled === true,
      outputPath: "",
      outputExtension: PROJECT_EXTENSIONS.has(input?.censorshipExtension) ? input.censorshipExtension : ".png"
    };
    await fs.promises.mkdir(savePath, { recursive: true });
    await fs.promises.mkdir(originAssetRoot({ savePath }), { recursive: true });
    if (censorshipConfig.enabled) await fs.promises.mkdir(cleanedAssetRoot({ savePath }), { recursive: true });
    return store.createProject({ name, savePath, censorshipConfig });
  });
  ipcMain.handle("projects:delete", (_event, id) => store.deleteProject(requiredText(id, "프로젝트 ID")));
  ipcMain.handle("projects:save", async (_event, input) => {
    const validated = validateProjectConfig(input);
    await fs.promises.mkdir(originAssetRoot(validated), { recursive: true });
    if (validated.censorshipConfig.enabled) await fs.promises.mkdir(cleanedAssetRoot(validated), { recursive: true });
    const project = store.saveProject(validated);
    return store.getProject(project.id);
  });
  ipcMain.handle("path-rules:preview", (_event, input) => {
    const project = validateProjectConfig(input.project);
    return renderRelativePath(project, input.selections || {}, "preview.png");
  });
  ipcMain.handle("prompts:list", (_event, projectId) => store.listPrompts(requiredText(projectId, "프로젝트 ID")));
  ipcMain.handle("prompts:get", (_event, id) => store.getPrompt(requiredText(id, "프롬프트 ID")));
  ipcMain.handle("prompts:create", (_event, projectId) => store.createPrompt(requiredText(projectId, "프로젝트 ID")));
  ipcMain.handle("prompts:duplicate", (_event, id, projectId) => {
    const copy = store.duplicatePrompt(requiredText(id, "프롬프트 ID"), requiredText(projectId, "프로젝트 ID"));
    if (!copy) throw new Error("프롬프트를 찾을 수 없습니다.");
    return copy;
  });
  ipcMain.handle("prompts:save", (_event, input) => {
    const projectId = requiredText(input?.projectId, "프로젝트 ID");
    const id = requiredText(input?.id, "프롬프트 ID");
    const title = requiredText(input?.title, "프롬프트 제목");
    const content = typeof input?.content === "string" ? input.content : "";
    const saved = store.savePrompt({ id, projectId, title, content });
    if (!saved) throw new Error("프롬프트를 찾을 수 없습니다.");
    return saved;
  });
  ipcMain.handle("prompts:delete", (_event, id, projectId) => store.deletePrompt(requiredText(id, "프롬프트 ID"), requiredText(projectId, "프로젝트 ID")));
  ipcMain.handle("prompts:reorder", (_event, projectId, ids) => store.reorderPrompts(requiredText(projectId, "프로젝트 ID"), Array.isArray(ids) ? ids.map((id) => requiredText(id, "프롬프트 ID")) : []));
  ipcMain.handle("prompts:folders-list", (_event, projectId) => store.listProjectEntryFolders(requiredText(projectId, "프로젝트 ID"), "prompt"));
  ipcMain.handle("prompts:folders-create", (_event, projectId, name) => store.createProjectEntryFolder(requiredText(projectId, "프로젝트 ID"), "prompt", requiredText(name, "폴더 이름")));
  ipcMain.handle("prompts:folders-rename", (_event, projectId, id, name) => store.renameProjectEntryFolder(requiredText(id, "폴더 ID"), requiredText(projectId, "프로젝트 ID"), "prompt", requiredText(name, "폴더 이름")));
  ipcMain.handle("prompts:folders-delete", (_event, projectId, id) => store.deleteProjectEntryFolder(requiredText(id, "폴더 ID"), requiredText(projectId, "프로젝트 ID"), "prompt"));
  ipcMain.handle("prompts:folders-move", (_event, projectId, id, folderId) => store.moveProjectEntryToFolder(requiredText(id, "프롬프트 ID"), requiredText(projectId, "프로젝트 ID"), "prompt", typeof folderId === "string" ? folderId : ""));
  ipcMain.handle("situations:list", (_event, projectId) => store.listSituations(requiredText(projectId, "프로젝트 ID")));
  ipcMain.handle("situations:get", (_event, id) => store.getSituation(requiredText(id, "시작 상황 ID")));
  ipcMain.handle("situations:create", (_event, projectId) => store.createSituation(requiredText(projectId, "프로젝트 ID")));
  ipcMain.handle("situations:duplicate", (_event, id, projectId) => {
    const copy = store.duplicateSituation(requiredText(id, "시작 상황 ID"), requiredText(projectId, "프로젝트 ID"));
    if (!copy) throw new Error("시작 상황을 찾을 수 없습니다.");
    return copy;
  });
  ipcMain.handle("situations:save", (_event, input) => {
    const projectId = requiredText(input?.projectId, "프로젝트 ID");
    const id = requiredText(input?.id, "시작 상황 ID");
    const title = requiredText(input?.title, "시작 상황 제목");
    const content = typeof input?.content === "string" ? input.content : "";
    const saved = store.saveSituation({ id, projectId, title, content });
    if (!saved) throw new Error("시작 상황을 찾을 수 없습니다.");
    return saved;
  });
  ipcMain.handle("situations:delete", (_event, id, projectId) => store.deleteSituation(requiredText(id, "시작 상황 ID"), requiredText(projectId, "프로젝트 ID")));
  ipcMain.handle("situations:reorder", (_event, projectId, ids) => store.reorderSituations(requiredText(projectId, "프로젝트 ID"), Array.isArray(ids) ? ids.map((id) => requiredText(id, "시작 상황 ID")) : []));
  ipcMain.handle("situations:folders-list", (_event, projectId) => store.listProjectEntryFolders(requiredText(projectId, "프로젝트 ID"), "situation"));
  ipcMain.handle("situations:folders-create", (_event, projectId, name) => store.createProjectEntryFolder(requiredText(projectId, "프로젝트 ID"), "situation", requiredText(name, "폴더 이름")));
  ipcMain.handle("situations:folders-rename", (_event, projectId, id, name) => store.renameProjectEntryFolder(requiredText(id, "폴더 ID"), requiredText(projectId, "프로젝트 ID"), "situation", requiredText(name, "폴더 이름")));
  ipcMain.handle("situations:folders-delete", (_event, projectId, id) => store.deleteProjectEntryFolder(requiredText(id, "폴더 ID"), requiredText(projectId, "프로젝트 ID"), "situation"));
  ipcMain.handle("situations:folders-move", (_event, projectId, id, folderId) => store.moveProjectEntryToFolder(requiredText(id, "시작 상황 ID"), requiredText(projectId, "프로젝트 ID"), "situation", typeof folderId === "string" ? folderId : ""));
  ipcMain.handle("prompt-templates:list", () => store.listTemplates("prompt"));
  ipcMain.handle("prompt-templates:get", (_event, id) => store.getTemplate(requiredText(id, "프롬프트 템플릿 ID"), "prompt"));
  ipcMain.handle("prompt-templates:create", () => store.createTemplate("prompt"));
  ipcMain.handle("prompt-templates:duplicate", (_event, id) => {
    const copy = store.duplicateTemplate(requiredText(id, "프롬프트 템플릿 ID"), "prompt");
    if (!copy) throw new Error("프롬프트 템플릿을 찾을 수 없습니다.");
    return copy;
  });
  ipcMain.handle("prompt-templates:save", (_event, input) => {
    const saved = store.saveTemplate({ id: requiredText(input?.id, "프롬프트 템플릿 ID"), type: "prompt", title: requiredText(input?.title, "프롬프트 템플릿 제목"), folderId: typeof input?.folderId === "string" ? input.folderId : "", content: typeof input?.content === "string" ? input.content : "" });
    if (!saved) throw new Error("프롬프트 템플릿을 찾을 수 없습니다.");
    return saved;
  });
  ipcMain.handle("prompt-templates:delete", (_event, id) => store.deleteTemplate(requiredText(id, "프롬프트 템플릿 ID"), "prompt"));
  ipcMain.handle("prompt-templates:reorder", (_event, _projectId, ids) => store.reorderTemplates("prompt", Array.isArray(ids) ? ids.map((id) => requiredText(id, "프롬프트 템플릿 ID")) : []));
  ipcMain.handle("prompt-template-folders:list", () => store.listTemplateFolders("prompt"));
  ipcMain.handle("prompt-template-folders:create", (_event, name) => store.createTemplateFolder("prompt", requiredText(name, "폴더 이름")));
  ipcMain.handle("prompt-template-folders:rename", (_event, id, name) => store.renameTemplateFolder(requiredText(id, "폴더 ID"), "prompt", requiredText(name, "폴더 이름")));
  ipcMain.handle("prompt-template-folders:delete", (_event, id) => store.deleteTemplateFolder(requiredText(id, "폴더 ID"), "prompt"));
  ipcMain.handle("prompt-template-folders:move", (_event, id, folderId) => store.moveTemplateToFolder(requiredText(id, "프롬프트 템플릿 ID"), "prompt", typeof folderId === "string" ? folderId : ""));
  ipcMain.handle("situation-templates:list", () => store.listTemplates("situation"));
  ipcMain.handle("situation-templates:get", (_event, id) => store.getTemplate(requiredText(id, "시작 상황 템플릿 ID"), "situation"));
  ipcMain.handle("situation-templates:create", () => store.createTemplate("situation"));
  ipcMain.handle("situation-templates:duplicate", (_event, id) => {
    const copy = store.duplicateTemplate(requiredText(id, "시작 상황 템플릿 ID"), "situation");
    if (!copy) throw new Error("시작 상황 템플릿을 찾을 수 없습니다.");
    return copy;
  });
  ipcMain.handle("situation-templates:save", (_event, input) => {
    const saved = store.saveTemplate({ id: requiredText(input?.id, "시작 상황 템플릿 ID"), type: "situation", title: requiredText(input?.title, "시작 상황 템플릿 제목"), folderId: typeof input?.folderId === "string" ? input.folderId : "", content: typeof input?.content === "string" ? input.content : "" });
    if (!saved) throw new Error("시작 상황 템플릿을 찾을 수 없습니다.");
    return saved;
  });
  ipcMain.handle("situation-templates:delete", (_event, id) => store.deleteTemplate(requiredText(id, "시작 상황 템플릿 ID"), "situation"));
  ipcMain.handle("situation-templates:reorder", (_event, _projectId, ids) => store.reorderTemplates("situation", Array.isArray(ids) ? ids.map((id) => requiredText(id, "시작 상황 템플릿 ID")) : []));
  ipcMain.handle("situation-template-folders:list", () => store.listTemplateFolders("situation"));
  ipcMain.handle("situation-template-folders:create", (_event, name) => store.createTemplateFolder("situation", requiredText(name, "폴더 이름")));
  ipcMain.handle("situation-template-folders:rename", (_event, id, name) => store.renameTemplateFolder(requiredText(id, "폴더 ID"), "situation", requiredText(name, "폴더 이름")));
  ipcMain.handle("situation-template-folders:delete", (_event, id) => store.deleteTemplateFolder(requiredText(id, "폴더 ID"), "situation"));
  ipcMain.handle("situation-template-folders:move", (_event, id, folderId) => store.moveTemplateToFolder(requiredText(id, "시작 상황 템플릿 ID"), "situation", typeof folderId === "string" ? folderId : ""));
  ipcMain.handle("lorebook-templates:list", () => store.listTemplates("lorebook"));
  ipcMain.handle("lorebook-templates:get", (_event, id) => store.getTemplate(requiredText(id, "로어북 템플릿 ID"), "lorebook"));
  ipcMain.handle("lorebook-templates:create", () => store.createTemplate("lorebook"));
  ipcMain.handle("lorebook-templates:duplicate", (_event, id) => {
    const copy = store.duplicateTemplate(requiredText(id, "로어북 템플릿 ID"), "lorebook");
    if (!copy) throw new Error("로어북 템플릿을 찾을 수 없습니다.");
    return copy;
  });
  ipcMain.handle("lorebook-templates:reorder", (_event, _projectId, ids) => store.reorderTemplates("lorebook", Array.isArray(ids) ? ids.map((id) => requiredText(id, "로어북 템플릿 ID")) : []));
  ipcMain.handle("lorebook-templates:save", (_event, input) => {
    const keywords = Array.isArray(input?.keywords) ? [...new Set(input.keywords.filter((keyword) => typeof keyword === "string").map((keyword) => keyword.trim()).filter(Boolean))] : [];
    const folderId = typeof input?.folderId === "string" ? input.folderId : "";
    const saved = store.saveTemplate({ id: requiredText(input?.id, "로어북 템플릿 ID"), type: "lorebook", title: requiredText(input?.title, "로어북 템플릿 제목"), folderId, keywords, content: typeof input?.content === "string" ? input.content : "" });
    if (!saved) throw new Error("로어북 템플릿을 찾을 수 없습니다.");
    return saved;
  });
  ipcMain.handle("lorebook-templates:delete", (_event, id) => store.deleteTemplate(requiredText(id, "로어북 템플릿 ID"), "lorebook"));
  ipcMain.handle("lorebook-template-folders:list", () => store.listTemplateFolders("lorebook"));
  ipcMain.handle("lorebook-template-folders:create", (_event, name) => store.createTemplateFolder("lorebook", requiredText(name, "폴더 이름")));
  ipcMain.handle("lorebook-template-folders:rename", (_event, id, name) => store.renameTemplateFolder(requiredText(id, "폴더 ID"), "lorebook", requiredText(name, "폴더 이름")));
  ipcMain.handle("lorebook-template-folders:delete", (_event, id) => store.deleteTemplateFolder(requiredText(id, "폴더 ID"), "lorebook"));
  ipcMain.handle("lorebook-template-folders:move", (_event, id, folderId) => store.moveTemplateToFolder(requiredText(id, "로어북 템플릿 ID"), "lorebook", typeof folderId === "string" ? folderId : ""));
  ipcMain.handle("lorebooks:list", (_event, projectId) => store.listLorebooks(requiredText(projectId, "프로젝트 ID")));
  ipcMain.handle("lorebooks:get", (_event, id) => store.getLorebook(requiredText(id, "로어북 ID")));
  ipcMain.handle("lorebooks:create", (_event, projectId) => store.createLorebook(requiredText(projectId, "프로젝트 ID")));
  ipcMain.handle("lorebooks:duplicate", (_event, id, projectId) => {
    const copy = store.duplicateLorebook(requiredText(id, "로어북 ID"), requiredText(projectId, "프로젝트 ID"));
    if (!copy) throw new Error("로어북을 찾을 수 없습니다.");
    return copy;
  });
  ipcMain.handle("lorebooks:reorder", (_event, projectId, ids) => {
    const validProjectId = requiredText(projectId, "프로젝트 ID");
    const validIds = Array.isArray(ids) ? ids.map((id) => requiredText(id, "로어북 ID")) : [];
    return store.reorderLorebooks(validProjectId, validIds);
  });
  ipcMain.handle("lorebooks:save", (_event, input) => {
    const projectId = requiredText(input?.projectId, "프로젝트 ID");
    const id = requiredText(input?.id, "로어북 ID");
    const title = requiredText(input?.title, "로어북 제목");
    const keywords = Array.isArray(input?.keywords) ? [...new Set(input.keywords.filter((keyword) => typeof keyword === "string").map((keyword) => keyword.trim()).filter(Boolean))] : [];
    const content = typeof input?.content === "string" ? input.content : "";
    const saved = store.saveLorebook({ id, projectId, title, keywords, content });
    if (!saved) throw new Error("로어북을 찾을 수 없습니다.");
    return saved;
  });
  ipcMain.handle("lorebooks:delete", (_event, id, projectId) => store.deleteLorebook(requiredText(id, "로어북 ID"), requiredText(projectId, "프로젝트 ID")));
  ipcMain.handle("lorebooks:folders-list", (_event, projectId) => store.listProjectEntryFolders(requiredText(projectId, "프로젝트 ID"), "lorebook"));
  ipcMain.handle("lorebooks:folders-create", (_event, projectId, name) => store.createProjectEntryFolder(requiredText(projectId, "프로젝트 ID"), "lorebook", requiredText(name, "폴더 이름")));
  ipcMain.handle("lorebooks:folders-rename", (_event, projectId, id, name) => store.renameProjectEntryFolder(requiredText(id, "폴더 ID"), requiredText(projectId, "프로젝트 ID"), "lorebook", requiredText(name, "폴더 이름")));
  ipcMain.handle("lorebooks:folders-delete", (_event, projectId, id) => store.deleteProjectEntryFolder(requiredText(id, "폴더 ID"), requiredText(projectId, "프로젝트 ID"), "lorebook"));
  ipcMain.handle("lorebooks:folders-move", (_event, projectId, id, folderId) => store.moveProjectEntryToFolder(requiredText(id, "로어북 ID"), requiredText(projectId, "프로젝트 ID"), "lorebook", typeof folderId === "string" ? folderId : ""));
  ipcMain.handle("works:get", (_event, projectId) => store.getWork(requiredText(projectId, "프로젝트 ID")));
  ipcMain.handle("works:save", (_event, input) => {
    const projectId = requiredText(input?.projectId, "프로젝트 ID");
    const introduction = typeof input?.introduction === "string" ? input.introduction : "";
    const tags = Array.isArray(input?.tags) ? [...new Set(input.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))] : [];
    const characterPreference = ["ALL", "MALE", "FEMALE"].includes(input?.characterPreference) ? input.characterPreference : "ALL";
    const ageRating = ["SAFE", "UNSAFE"].includes(input?.ageRating) ? input.ageRating : "SAFE";
    return store.saveWork(projectId, introduction, tags, characterPreference, ageRating);
  });
  ipcMain.handle("works:list-images", (_event, projectId) => store.listWorkTitleImages(requiredText(projectId, "프로젝트 ID")));
  ipcMain.handle("works:create-slot", (_event, projectIdValue) => {
    const projectId = requiredText(projectIdValue, "프로젝트 ID");
    if (!store.getProject(projectId)) throw new Error("프로젝트를 찾을 수 없습니다.");
    return store.createWorkTitleSlot(projectId);
  });
  ipcMain.handle("works:add-image", async (_event, input) => {
    const projectId = requiredText(input?.projectId, "프로젝트 ID");
    const slotId = requiredText(input?.slotId, "타이틀 슬롯 ID");
    const project = store.getProject(projectId);
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    const slot = store.listWorkTitleImages(projectId).find((item) => item.id === slotId);
    if (!slot) throw new Error("타이틀 슬롯을 찾을 수 없습니다.");
    if (slot.savedPath) throw new Error("이미지가 들어 있는 타이틀 슬롯입니다.");
    const sourcePath = path.resolve(requiredText(input?.sourcePath, "원본 파일"));
    let sourceStats;
    try { sourceStats = await fs.promises.stat(sourcePath); }
    catch (error) { if (error.code === "ENOENT") throw new Error("지원하는 이미지 파일을 선택해 주세요."); throw error; }
    if (!sourceStats.isFile() || !IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) throw new Error("지원하는 이미지 파일을 선택해 주세요.");
    const fileName = `Title${String(Number(slot.position) + 1).padStart(3, "0")}${path.extname(sourcePath).toLowerCase()}`;
    const destination = path.join(project.savePath, fileName);
    try { await fs.promises.copyFile(sourcePath, destination, fs.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code === "EEXIST") throw new Error(`${fileName} 파일이 이미 있습니다.`); throw error; }
    if (!store.setWorkTitleSlotImage(slotId, projectId, fileName, destination)) {
      await fs.promises.unlink(destination).catch(() => {});
      throw new Error("타이틀 슬롯에 이미지를 저장하지 못했습니다.");
    }
    return store.listWorkTitleImages(projectId).find((item) => item.id === slotId);
  });
  ipcMain.handle("works:delete-image", async (_event, projectIdValue, idValue) => {
    const projectId = requiredText(projectIdValue, "프로젝트 ID");
    const id = requiredText(idValue, "타이틀 이미지 ID");
    const image = store.listWorkTitleImages(projectId).find((item) => item.id === id);
    if (!image) throw new Error("타이틀 이미지를 찾을 수 없습니다.");
    return withStagedFileDeletion([image.savedPath], () => {
      if (!store.clearWorkTitleSlotImage(id, projectId)) throw new Error("타이틀 이미지 정보를 삭제하지 못했습니다.");
      return true;
    });
  });
  ipcMain.handle("works:delete-slot", async (_event, projectIdValue, idValue) => {
    const projectId = requiredText(projectIdValue, "프로젝트 ID");
    const id = requiredText(idValue, "타이틀 슬롯 ID");
    const image = store.listWorkTitleImages(projectId).find((item) => item.id === id);
    if (!image) throw new Error("타이틀 슬롯을 찾을 수 없습니다.");
    return withStagedFileDeletion([image.savedPath], () => {
      store.removeWorkTitleImage(id, projectId);
      return true;
    });
  });
  ipcMain.handle("assets:list", (_event, projectId) => store.listAssets(requiredText(projectId, "프로젝트 ID")));
  ipcMain.handle("assets:ai-logs", () => aiCensorshipLogs.map((entry) => ({ ...entry })));
  ipcMain.handle("standalone-ai:run", async (event, input) => {
    if (activeAiCensorshipPromise) throw new Error("이미 AI 검열 작업이 실행 중입니다.");
    const packagedWorkerPath = app.isPackaged ? aiRuntime.installedWorkerPath() : "";
    if (app.isPackaged && !packagedWorkerPath) throw new Error("AI 검열 기능이 설치되어 있지 않거나 현재 버전과 호환되지 않습니다.");
    const requestedFiles = Array.isArray(input?.files) ? input.files : [];
    if (!requestedFiles.length) throw new Error("작업할 이미지를 선택해 주세요.");
    if (requestedFiles.length > 10000) throw new Error("한 번에 최대 10,000개의 이미지를 처리할 수 있습니다.");
    const requestedAssets = await Promise.all(requestedFiles.map((item) => validatedImage(item?.sourcePath, item?.relativePath)));
    const outputRoot = path.resolve(requiredText(input?.outputPath, "출력 폴더"));
    const outputStats = await statsOrNull(outputRoot);
    if (!outputStats?.isDirectory()) throw new Error("사용할 수 있는 출력 폴더를 선택해 주세요.");
    const outputExtension = input?.outputExtension === "original" ? "original" : String(input?.outputExtension || "").toLowerCase();
    const planned = await planStandaloneOutputs(outputRoot, requestedAssets, outputExtension, input?.conflictPolicy);
    const { assets, outputPaths, skipped } = planned;
    const settings = input?.settings && typeof input.settings === "object" ? input.settings : {};
    const details = skipped.map(({ asset, outputPath }) => ({ relativePath: asset.relativePath, status: "skipped", outputPath, error: "같은 이름의 파일이 있어 건너뛰었습니다.", detectionCount: 0 }));
    skipped.forEach(({ asset }) => appendAiCensorshipLog("info", `건너뜀 · ${asset.relativePath} · 같은 이름의 파일 존재`));
    if (!assets.length) {
      appendAiCensorshipLog("info", `독립 작업 완료 · 건너뜀 ${skipped.length}개`);
      return { total: requestedAssets.length, succeeded: 0, failed: 0, skipped: skipped.length, details, outputPath: outputRoot };
    }
    appendAiCensorshipLog("info", `독립 작업 시작 · 이미지 ${assets.length}개${skipped.length ? ` · 건너뜀 ${skipped.length}개` : ""} · 모델 ${path.basename(String(settings.modelPath || "")) || "미지정"}`);
    const controller = new AbortController();
    activeAiCensorshipController = controller;
    const task = runAiCensorship({
      assets,
      settings,
      workerPath: packagedWorkerPath,
      resolveOutputPath: (asset) => outputPaths.get(asset.id),
      onProgress: (progress) => {
        if (progress.stage === "detecting" && progress.completed === 0) appendAiCensorshipLog("info", progress.message);
        if (!event.sender.isDestroyed()) event.sender.send("standalone-ai:progress", progress);
      },
      onResult: (asset, status, outputPath, errorMessage, detectionCount = 0) => {
        details.push({ relativePath: asset.relativePath, status, outputPath: outputPath || "", error: errorMessage || "", detectionCount });
        if (status === "failed") appendAiCensorshipLog("error", `실패 · ${asset.relativePath} · ${errorMessage || "원인을 확인할 수 없습니다."}`);
        else if (detectionCount === 0) appendAiCensorshipLog("info", `대상 없음 · ${asset.relativePath}`);
        else appendAiCensorshipLog("success", `완료 · ${asset.relativePath} · 마스크 ${detectionCount}개`);
      },
      signal: controller.signal
    });
    activeAiCensorshipPromise = task;
    try {
      const result = await task;
      appendAiCensorshipLog(result.failed ? "warning" : "success", `독립 작업 완료 · 성공 ${result.succeeded}개 · 실패 ${result.failed}개${skipped.length ? ` · 건너뜀 ${skipped.length}개` : ""}`);
      return { ...result, total: requestedAssets.length, skipped: skipped.length, details, outputPath: outputRoot };
    } catch (error) {
      appendAiCensorshipLog(error.code === "ABORT_ERR" ? "warning" : "error", `${error.code === "ABORT_ERR" ? "독립 작업 취소" : "독립 작업 중단"} · ${error.message}`);
      throw error;
    } finally {
      if (activeAiCensorshipPromise === task) activeAiCensorshipPromise = null;
      if (activeAiCensorshipController === controller) activeAiCensorshipController = null;
    }
  });
  ipcMain.handle("standalone-ai:cancel", async () => {
    if (!activeAiCensorshipPromise || !activeAiCensorshipController) return false;
    appendAiCensorshipLog("warning", "독립 작업 취소 요청");
    activeAiCensorshipController.abort();
    await Promise.race([activeAiCensorshipPromise.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000))]);
    return true;
  });
  ipcMain.handle("assets:ai-censor", async (event, input) => {
    if (activeAiCensorshipPromise) throw new Error("이미 AI 검열 작업이 실행 중입니다.");
    const packagedWorkerPath = app.isPackaged ? aiRuntime.installedWorkerPath() : "";
    if (app.isPackaged && !packagedWorkerPath) throw new Error("AI 검열 기능이 설치되어 있지 않거나 현재 버전과 호환되지 않습니다.");
    const project = store.getProject(requiredText(input?.projectId, "프로젝트 ID"));
    if (!project || !project.censorshipConfig.enabled) throw new Error("에셋 검열이 활성화된 프로젝트를 찾을 수 없습니다.");
    const requestedIds = new Set(Array.isArray(input?.assetIds) ? input.assetIds.filter((id) => typeof id === "string") : []);
    const assets = store.listAssets(project.id).filter((asset) => requestedIds.has(asset.id));
    if (!assets.length || assets.length !== requestedIds.size) throw new Error("작업할 이미지 목록이 올바르지 않습니다.");
    const settings = input?.settings && typeof input.settings === "object" ? input.settings : {};
    appendAiCensorshipLog("info", `작업 시작 · ${project.name} · 이미지 ${assets.length}개 · 모델 ${path.basename(String(settings.modelPath || "")) || "미지정"}`);
    const controller = new AbortController();
    activeAiCensorshipController = controller;
    const task = runAiCensorship({
      project,
      assets,
      settings,
      workerPath: packagedWorkerPath,
      onProgress: (progress) => {
        if (progress.stage === "detecting" && progress.completed === 0) appendAiCensorshipLog("info", progress.message);
        if (!event.sender.isDestroyed()) event.sender.send("assets:ai-progress", progress);
      },
      onResult: (asset, status, cleanedPath, errorMessage, detectionCount) => {
        const result = store.setAssetReview(asset.id, status, cleanedPath);
        if (status === "failed") appendAiCensorshipLog("error", `실패 · ${asset.relativePath} · ${errorMessage || "원인을 확인할 수 없습니다."}`);
        else if (detectionCount === 0) appendAiCensorshipLog("info", `대상 없음 · ${asset.relativePath}`);
        else appendAiCensorshipLog("success", `완료 · ${asset.relativePath} · 마스크 ${detectionCount}개`);
        return result;
      },
      signal: controller.signal
    });
    activeAiCensorshipPromise = task;
    try {
      const result = await task;
      appendAiCensorshipLog(result.failed ? "warning" : "success", `작업 완료 · 성공 ${result.succeeded}개 · 실패 ${result.failed}개`);
      return result;
    } catch (error) {
      appendAiCensorshipLog(error.code === "ABORT_ERR" ? "warning" : "error", `${error.code === "ABORT_ERR" ? "작업 취소" : "작업 중단"} · ${error.message}`);
      throw error;
    }
    finally {
      if (activeAiCensorshipPromise === task) activeAiCensorshipPromise = null;
      if (activeAiCensorshipController === controller) activeAiCensorshipController = null;
    }
  });
  ipcMain.handle("assets:cancel-ai", async () => {
    if (!activeAiCensorshipPromise || !activeAiCensorshipController) return false;
    appendAiCensorshipLog("warning", "작업 취소 요청");
    activeAiCensorshipController.abort();
    await Promise.race([activeAiCensorshipPromise.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000))]);
    return true;
  });
  ipcMain.handle("assets:refresh", async (_event, projectId) => {
    const project = store.getProject(requiredText(projectId, "프로젝트 ID"));
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    return store.refreshTrackedMetadata(project.id, await refreshTrackedFiles(store.listAssets(project.id)));
  });
  ipcMain.handle("assets:sync-external", async (_event, projectId, targetExtension) => {
    const project = store.getProject(requiredText(projectId, "프로젝트 ID"));
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    const extension = typeof targetExtension === "string" ? targetExtension.toLowerCase() : "";
    if (!IMAGE_EXTENSIONS.has(extension)) throw new Error("추적할 파일 확장자를 선택해 주세요.");
    return store.replaceProjectInventory(project.id, await scanProjectInventory(project, extension));
  });
  ipcMain.handle("assets:forget", (_event, assetId) => store.removeAsset(requiredText(assetId, "에셋 ID")));
  ipcMain.handle("assets:delete", async (_event, assetId) => {
    const id = requiredText(assetId, "에셋 ID");
    await (censoredSaveQueues.get(id) || Promise.resolve()).catch(() => {});
    const asset = store.getAsset(id);
    if (!asset) throw new Error("삭제할 이미지를 찾을 수 없습니다.");
    return withStagedFileDeletion([asset.savedPath, asset.cleanedPath], () => store.removeAsset(id));
  });
  ipcMain.handle("assets:set-review", (_event, assetId, status, options) => {
    const id = requiredText(assetId, "에셋 ID");
    const previous = censoredSaveQueues.get(id) || Promise.resolve();
    const queued = previous.catch(() => {}).then(async () => {
      if (status === "unreviewed" && options?.preserveCensored !== true) {
        const asset = store.getAsset(id);
        const project = asset ? store.getProject(asset.projectId) : null;
        if (project && asset) await ensureCensorshipCopy(project, asset, true);
      }
      return store.setAssetReview(id, status);
    });
    censoredSaveQueues.set(id, queued);
    queued.finally(() => { if (censoredSaveQueues.get(id) === queued) censoredSaveQueues.delete(id); }).catch(() => {});
    return queued;
  });
  ipcMain.handle("assets:data-url", async (_event, assetId, original = false) => {
    const id = requiredText(assetId, "에셋 ID");
    let row = store.getAsset(id);
    if (!original && row) {
      const project = store.getProject(row.projectId);
      if (project) await ensureCensorshipCopy(project, row);
      row = store.getAsset(id);
    }
    const cleanedExists = row?.cleanedPath ? await statsOrNull(row.cleanedPath) : null;
    const assetPath = !original && ["auto", "manual"].includes(row?.reviewStatus) && cleanedExists?.isFile() ? row.cleanedPath : row?.savedPath;
    if (!assetPath || !(await statsOrNull(assetPath))?.isFile()) throw new Error("이미지 파일을 찾을 수 없습니다.");
    const extension = path.extname(assetPath).slice(1).replace("jpg", "jpeg");
    return `data:image/${extension};base64,${(await fs.promises.readFile(assetPath)).toString("base64")}`;
  });
  ipcMain.handle("assets:url", async (_event, assetId, original = false) => {
    const id = requiredText(assetId, "에셋 ID");
    let row = store.getAsset(id);
    if (!original && row) {
      const project = store.getProject(row.projectId);
      if (project) await ensureCensorshipCopy(project, row);
      row = store.getAsset(id);
    }
    const cleanedExists = row?.cleanedPath ? await statsOrNull(row.cleanedPath) : null;
    const assetPath = !original && ["auto", "manual"].includes(row?.reviewStatus) && cleanedExists?.isFile() ? row.cleanedPath : row?.savedPath;
    const assetStats = assetPath ? await statsOrNull(assetPath) : null;
    if (!assetStats?.isFile()) throw new Error("이미지 파일을 찾을 수 없습니다.");
    return `aaa-asset://local/asset/${encodeURIComponent(id)}?variant=${original ? "original" : "display"}&v=${assetStats.mtimeMs}`;
  });
  ipcMain.handle("assets:save-censored", (_event, assetId, dataUrl) => {
    const id = requiredText(assetId, "에셋 ID");
    const previous = censoredSaveQueues.get(id) || Promise.resolve();
    const queued = previous.catch(() => {}).then(async () => {
      const asset = store.getAsset(id);
      if (!asset) throw new Error("에셋을 찾을 수 없습니다.");
      const project = store.getProject(asset.projectId);
      const outputRoot = cleanedAssetRoot(project);
      const outputExtension = censorshipOutputExtension(project, asset.savedPath);
      const relativeOutputPath = asset.relativePath.replace(/\.[^./\\]+$/, outputExtension);
      const outputPath = path.join(outputRoot, relativeOutputPath);
      const match = /^data:image\/[^;]+;base64,(.+)$/.exec(dataUrl || "");
      if (!match) throw new Error("편집 이미지 형식이 올바르지 않습니다.");
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await require("sharp")(Buffer.from(match[1], "base64")).toFile(outputPath);
      store.setAssetReview(id, "manual", outputPath);
      return outputPath;
    });
    censoredSaveQueues.set(id, queued);
    queued.finally(() => { if (censoredSaveQueues.get(id) === queued) censoredSaveQueues.delete(id); }).catch(() => {});
    return queued;
  });
  ipcMain.handle("assets:classify", async (_event, input) => {
    const project = store.getProject(requiredText(input?.projectId, "프로젝트 ID"));
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    const result = await copyClassifiedAsset({
      project,
      sourcePath: requiredText(input?.sourcePath, "원본 파일"),
      selections: input?.selections || {},
      overwrite: input?.overwrite === true
    });
    if (result.collision) return result;
    const asset = store.addAsset({
      projectId: project.id,
      sourceName: result.sourceName,
      relativePath: result.relativePath,
      savedPath: result.destination,
      fileSize: result.fileSize,
      modifiedAt: result.modifiedAt
    });
    return { ...result, asset };
  });
  ipcMain.on("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle("window:is-maximized", (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false);
  ipcMain.on("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    window.isMaximized() ? window.unmaximize() : window.maximize();
  });
  ipcMain.on("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("window:confirm-close", async (event) => {
    activeAiCensorshipController?.abort();
    await Promise.race([
      Promise.allSettled([...censoredSaveQueues.values(), activeAiCensorshipPromise].filter(Boolean)),
      new Promise((resolve) => setTimeout(resolve, 5000))
    ]);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    approvedCloseWindows.add(window);
    window.close();
    return true;
  });
}

app.whenReady().then(async () => {
  const initialWindow = await createWindow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const databasePath = path.join(app.getPath("userData"), "aaa.sqlite");
  store = new Store(databasePath);
  aiRuntime = new AiRuntimeManager(app);
  protocol.handle("aaa-asset", async (request) => {
    const url = new URL(request.url);
    if (url.hostname === "local") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "gif-preview") {
        const entry = gifPreviewPaths.get(parts[1]);
        if (!entry || !fs.existsSync(entry.imagePath)) return responseWithCors("Not found", { status: 404 });
        entry.lastAccess = Date.now();
        const thumbnail = await sharp(entry.imagePath, { animated: false }).rotate().resize(256, 256, { fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
        return responseWithCors(thumbnail, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=31536000, immutable" } });
      }
      if (parts[0] === "gif-result") {
        const preview = animationPreviewFiles.get(parts[1]);
        if (!preview || !fs.existsSync(preview.filePath)) return responseWithCors("Not found", { status: 404 });
        const fetched = await net.fetch(pathToFileURL(preview.filePath).toString());
        return responseWithCors(fetched.body, { status: fetched.status, headers: fetched.headers });
      }
      if (parts[0] === "sticker") {
        let localPath;
        try { localPath = stickerPath(stickerRoot(), decodeURIComponent(parts[1] || "")); }
        catch { return responseWithCors("Not found", { status: 404 }); }
        if (!fs.existsSync(localPath)) return responseWithCors("Not found", { status: 404 });
        const fetched = await net.fetch(pathToFileURL(localPath).toString());
        return responseWithCors(fetched.body, { status: fetched.status, headers: { ...Object.fromEntries(fetched.headers), "Cache-Control": "private, max-age=31536000, immutable" } });
      }
      if (parts[0] === "twemoji") {
        let localPath;
        try { localPath = twemojiSvgPath(decodeURIComponent(parts[1] || "").replace(/\.svg$/i, "")); }
        catch { return responseWithCors("Not found", { status: 404 }); }
        if (!fs.existsSync(localPath)) return responseWithCors("Not found", { status: 404 });
        return responseWithCors(await fs.promises.readFile(localPath), { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=31536000, immutable" } });
      }
      if (parts[0] === "asset") {
        const id = decodeURIComponent(parts[1] || "");
        const row = store.getAsset(id);
        const assetPath = url.searchParams.get("variant") !== "original" && ["auto", "manual"].includes(row?.reviewStatus) && row?.cleanedPath && fs.existsSync(row.cleanedPath) ? row.cleanedPath : row?.savedPath;
        if (!assetPath || !fs.existsSync(assetPath)) return responseWithCors("Not found", { status: 404 });
        const fetched = await net.fetch(pathToFileURL(assetPath).toString());
        return responseWithCors(fetched.body, { status: fetched.status, headers: fetched.headers });
      }
      return responseWithCors("Not found", { status: 404 });
    }
    const assetPath = store.getAssetPath(url.hostname);
    if (!assetPath || !fs.existsSync(assetPath)) return responseWithCors("Not found", { status: 404 });
    const fetched = await net.fetch(pathToFileURL(assetPath).toString());
    return responseWithCors(fetched.body, { status: fetched.status, headers: fetched.headers });
  });
  registerIpc();
  await loadApplication(initialWindow);
  configureAutoUpdate();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const window = await createWindow();
      await loadApplication(window);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  aiRuntime?.cancelInstall();
  for (const preview of animationPreviewFiles.values()) {
    try { fs.unlinkSync(preview.filePath); } catch {}
  }
  animationPreviewFiles.clear();
});
