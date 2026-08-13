import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bookmark, Download, ExternalLink, FolderArchive, Globe, ListTree, LoaderCircle, Play, RotateCw, Square, Upload, X } from "lucide-react";
import { groupPlatformAssetsByFolder, platformAssets } from "../shared.js";

const BROWSER_HOME = `data:text/html;charset=UTF-8,${encodeURIComponent(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f4;color:#242424;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(620px,calc(100% - 48px));padding:42px;border:1px solid #deded9;border-radius:16px;background:#fff;box-shadow:0 8px 28px rgba(0,0,0,.05)}h1{margin:0 0 14px;font-size:24px}p{margin:0;color:#666;line-height:1.7}.steps{display:grid;gap:10px;margin-top:26px;padding:0;list-style:none}.steps li{padding:12px 14px;border-radius:9px;background:#f4f4f1;color:#444}</style></head><body><main class="card"><h1>플랫폼 내보내기</h1><p>주소를 입력하거나 내보내기 화면의 바로가기를 이용해 플랫폼에 접속하세요.</p><ol class="steps"><li>1. 플랫폼에 로그인하고 제작 페이지로 이동합니다.</li><li>2. 상단에서 템플릿을 선택하고 실행을 누릅니다.</li><li>3. 설정 창에서 항목을 선택한 뒤 내부 실행 버튼을 누릅니다.</li></ol></main></body></html>`)}`;

const TEMPLATE_DECLARATION_PATTERN = /\/\*\s*@aaa-template\s*([\s\S]*?)@aaa-template-end\s*\*\//;
const ALL_FOLDER_SELECTION = "@aaa:all";

function parseTemplateDeclaration(script) {
  const block = String(script || "").match(TEMPLATE_DECLARATION_PATTERN);
  if (!block) return { version: 1, description: "", inputs: [] };
  let declaration;
  try { declaration = JSON.parse(block[1]); }
  catch { throw new Error("템플릿 상단의 @aaa-template 선언이 올바른 JSON 형식이 아닙니다."); }
  const inputs = Array.isArray(declaration?.inputs) ? declaration.inputs : [];
  const keys = new Set();
  const normalized = inputs.map((input, index) => {
    const key = String(input?.key || "").trim();
    const source = String(input?.source || "").trim();
    const selection = String(input?.selection || "all").trim();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) throw new Error(`${index + 1}번째 입력의 key가 올바르지 않습니다.`);
    if (keys.has(key)) throw new Error(`입력 key '${key}'가 중복되었습니다.`);
    if (selection !== "choice" && !source) throw new Error(`${key} 입력에 source가 없습니다.`);
    if (!["single", "boolean", "folder", "all", "choice"].includes(selection)) throw new Error(`${key} 입력의 selection이 올바르지 않습니다.`);
    const options = selection === "choice" ? (Array.isArray(input?.options) ? input.options : []).map((option) => {
      const value = String(option && typeof option === "object" ? option.value : option ?? "").trim();
      const label = String(option && typeof option === "object" ? option.label ?? value : value).trim();
      return { value, label: label || value };
    }) : [];
    if (selection === "choice" && (!options.length || options.some((option) => !option.value) || new Set(options.map((option) => option.value)).size !== options.length)) throw new Error(`${key} 입력의 options가 올바르지 않습니다.`);
    const whenKey = String(input?.when?.key || "").trim();
    const whenValues = Array.isArray(input?.when?.values) ? [...new Set(input.when.values.map((value) => String(value).trim()).filter(Boolean))] : [];
    keys.add(key);
    return { key, source, selection, options, when: whenKey && whenValues.length ? { key: whenKey, values: whenValues } : null, label: String(input?.label || key), description: String(input?.description || "") };
  });
  for (const input of normalized) {
    if (input.when && (!keys.has(input.when.key) || input.when.key === input.key)) throw new Error(`${input.key} 입력의 when 조건이 올바르지 않습니다.`);
  }
  return { version: Number(declaration?.version) || 1, description: String(declaration?.description || "").trim(), inputs: normalized };
}

function valueAtPath(data, path) {
  return String(path || "").split(".").reduce((value, key) => value !== null && value !== undefined && !["__proto__", "prototype", "constructor"].includes(key) ? value[key] : undefined, data);
}

function optionKey(item, index) {
  if (item === null || typeof item !== "object") return `@index:${index}`;
  const value = item.id ?? item.path ?? item.file ?? item.value;
  return value === undefined || value === "" ? `@index:${index}` : String(value);
}

function optionLabel(item, index) {
  if (item === null || typeof item !== "object") return String(item ?? `항목 ${index + 1}`);
  const label = item?.title || item?.name || item?.label || item?.sourceName || (Object.hasOwn(item, "path") && item.path === "" ? "루트" : item?.path) || item?.relativePath || item?.file || `항목 ${index + 1}`;
  const count = Array.isArray(item?.items) ? item.items.length : Array.isArray(item?.assets) ? item.assets.length : null;
  if (count !== null) return `${label} (${count}개)`;
  if (typeof item?.content === "string") return `${label} (${item.content.length}자)`;
  return String(label);
}

function applyAssetNameMode(items, mode) {
  if (mode !== "filename") return items;
  return items.map((item) => {
    const filename = String(item.relativePath || item.file || "").replaceAll("\\", "/").split("/").at(-1) || item.name;
    return { ...item, name: filename.replace(/\.[^/.]+$/, "") };
  });
}

function folderAllItems(context, source, folders) {
  const itemSource = String(source || "").endsWith(".folders") ? `${source.slice(0, -".folders".length)}.items` : "";
  const directItems = itemSource ? valueAtPath(context, itemSource) : undefined;
  if (Array.isArray(directItems)) return directItems;
  const seen = new Set();
  return (folders || []).flatMap((folder) => Array.isArray(folder?.items) ? folder.items : Array.isArray(folder?.assets) ? folder.assets : []).filter((item) => {
    const key = item?.id || item?.file || item?.relativePath || item;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assetsAreDisabled(declaration, selections) {
  const toggle = declaration.inputs.find((input) => input.selection === "boolean" && input.source === "assets.enabled");
  return Boolean(toggle) && selections[toggle.key] === false;
}

function isUploadDependentAssetSource(source) {
  return source === "assets.items" || source === "assets.folders" || source === "assets.token";
}

function inputIsActive(input, selections) {
  return !input.when || input.when.values.includes(String(selections[input.when.key] ?? ""));
}

function countSelectedOperations(value) {
  if (Array.isArray(value)) return value.length + value.reduce((total, item) => total + countSelectedOperations(item), 0);
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce((total, item) => total + countSelectedOperations(item), 0);
}

function ExportSetupModal({ setup, selections, assetVariant, assetNameMode, onAssetVariantChange, onAssetNameModeChange, onChange, onClose, onRun }) {
  const fields = setup.declaration.inputs.filter((input) => inputIsActive(input, selections)).map((input) => ({ ...input, sourceValue: input.selection === "choice" ? input.options : valueAtPath(setup.previewContext, input.source) }));
  const assetsDisabled = assetsAreDisabled(setup.declaration, selections);
  const hasAssetFields = fields.some((field) => field.source.startsWith("assets."));
  const uploadToggle = fields.find((field) => field.selection === "boolean" && field.source === "assets.enabled");
  const fieldIsDisabled = (field) => assetsDisabled && isUploadDependentAssetSource(field.source);
  const invalid = fields.some((field) => {
    if (fieldIsDisabled(field)) return false;
    if (field.selection === "choice") return !field.options.some((option) => option.value === selections[field.key]);
    if (field.sourceValue === undefined) return true;
    if (field.selection === "all") return false;
    if (field.selection === "boolean") return typeof selections[field.key] !== "boolean";
    if (!Array.isArray(field.sourceValue)) return true;
    return !selections[field.key];
  });
  const variantField = <section className={`platform-export-setup-field ${assetsDisabled ? "disabled" : ""}`} key="asset-variant"><header><span><strong>에셋 이미지 종류</strong><small>추가 에셋에 사용할 원본 또는 검열본을 선택합니다.</small></span></header><select value={assetVariant} disabled={assetsDisabled} onChange={(event) => onAssetVariantChange(event.target.value)}><option value="origin">원본</option><option value="cleaned">검열본</option></select></section>;
  const nameModeField = <section className={`platform-export-setup-field ${assetsDisabled ? "disabled" : ""}`} key="asset-name-mode"><header><span><strong>에셋 이름 방식</strong><small>업로드 후 사용할 에셋 이름 형식을 선택합니다.</small></span></header><select value={assetNameMode} disabled={assetsDisabled} onChange={(event) => onAssetNameModeChange(event.target.value)}><option value="classification">키워드 조합</option><option value="filename">파일 이름</option></select></section>;
  const rows = [];
  if (hasAssetFields && !uploadToggle) rows.push(variantField, nameModeField);
  for (const field of fields) {
    const disabled = fieldIsDisabled(field);
    const folderItems = field.selection === "folder" && Array.isArray(field.sourceValue) ? folderAllItems(setup.previewContext, field.source, field.sourceValue) : [];
    rows.push(<section className={`platform-export-setup-field ${disabled ? "disabled" : ""}`} key={field.key}><header><span><strong>{field.label}</strong>{field.description && <small>{field.description}</small>}</span>{field.source && <code>{field.source}</code>}</header>{field.selection === "choice" ? <select value={selections[field.key] || ""} onChange={(event) => onChange(field.key, event.target.value)}>{field.options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select> : field.sourceValue === undefined ? <p className="error">해당 변수를 찾을 수 없습니다.</p> : field.selection === "all" ? <div className="platform-export-auto-value">전체 값을 자동으로 전달합니다.</div> : field.selection === "boolean" ? <label className="platform-export-boolean"><input type="checkbox" checked={selections[field.key] === true} onChange={(event) => onChange(field.key, event.target.checked)} /><span>{selections[field.key] ? "사용" : "사용 안 함"}</span></label> : <select disabled={disabled} value={selections[field.key] || ""} onChange={(event) => onChange(field.key, event.target.value)}><option value="">선택</option>{field.selection === "folder" && <option value={ALL_FOLDER_SELECTION}>전체 목록 ({folderItems.length})</option>}{field.sourceValue.filter((item) => !(field.selection === "folder" && item?.path === "")).map((item, index) => <option value={optionKey(item, index)} key={optionKey(item, index)}>{optionLabel(item, index)}</option>)}</select>}</section>);
    if (field === uploadToggle) rows.push(variantField, nameModeField);
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal platform-export-setup-modal" role="dialog" aria-modal="true" aria-labelledby="platform-export-setup-title"><div className="modal-heading"><div><h2 id="platform-export-setup-title">내보내기 설정</h2><p>{setup.platform.name}</p></div><button className="modal-close" aria-label="설정 닫기" onClick={onClose}>×</button></div><div className="platform-export-setup-fields">{setup.declaration.description && <section className="platform-export-description"><strong>실행 안내</strong><p>{setup.declaration.description}</p></section>}{rows}{!fields.length && <div className="platform-export-no-settings"><strong>추가 설정이 없습니다.</strong><p>이 템플릿은 별도로 선택할 항목을 선언하지 않았습니다.</p></div>}</div><div className="modal-actions"><button className="outline-button" onClick={onClose}>취소</button><button className="primary-button button-with-icon" disabled={invalid} onClick={onRun}><Play size={16} />실행</button></div></section></div>;
}

function ExportProject({ project }) {
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  const [platforms, setPlatforms] = useState([]);
  const [platformFolders, setPlatformFolders] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [activePlatform, setActivePlatform] = useState(null);
  const [setup, setSetup] = useState(null);
  const [setupSelections, setSetupSelections] = useState({});
  const [setupAssetVariant, setSetupAssetVariant] = useState("origin");
  const [setupAssetNameMode, setSetupAssetNameMode] = useState("classification");
  const [setupLoading, setSetupLoading] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserReady, setBrowserReady] = useState(false);
  const [browserAddress, setBrowserAddress] = useState("");
  const [browserSource, setBrowserSource] = useState(BROWSER_HOME);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const [bookmarkMenuOpen, setBookmarkMenuOpen] = useState(false);
  const browserRef = useRef(null);
  const logPanelRef = useRef(null);
  const cancelRequested = useRef(false);
  const protectionActive = useRef(false);
  const securityViolation = useRef("");

  function appendLog(message) {
    const text = String(message || "").trim();
    if (!text) return;
    setLogs((current) => [...current, { id: crypto.randomUUID(), time: new Date().toLocaleTimeString("ko-KR", { hour12: false }), message: text }]);
  }

  useEffect(() => {
    Promise.all([window.aaa.exportTemplates.list(), window.aaa.exportTemplates.listFolders(), window.aaa.exportBookmarks.list()]).then(([loadedPlatforms, loadedFolders, loadedBookmarks]) => {
      setPlatforms(loadedPlatforms); setPlatformFolders(loadedFolders); setBookmarks(loadedBookmarks);
    }).catch((error) => setStatus(error.message));
  }, [project.id]);

  useEffect(() => window.aaa.exportSecurity.onViolation((detail) => {
    const message = String(detail?.message || "자동 입력의 위험한 동작을 차단했습니다.");
    securityViolation.current = message;
    appendLog(`보안 차단: ${message}`);
    setStatus(`보안 차단: ${message}`);
  }), []);

  useEffect(() => {
    const browser = browserRef.current;
    if (!browserOpen || !browser) return undefined;
    const syncNavigation = (event) => {
      const currentUrl = event?.url || browser.getURL?.() || BROWSER_HOME;
      setBrowserAddress(currentUrl.startsWith("data:text/html") ? "aaa://home" : currentUrl);
      setCanGoBack(browser.canGoBack?.() || false);
      setCanGoForward(browser.canGoForward?.() || false);
    };
    const ready = () => { setBrowserReady(true); syncNavigation(); };
    const loading = () => setBrowserReady(false);
    const stopped = () => { setBrowserReady(true); syncNavigation(); };
    const consoleMessage = (event) => {
      const prefix = "[AAA_EXPORT] ";
      if (event.message?.startsWith(prefix)) appendLog(event.message.slice(prefix.length));
    };
    browser.addEventListener("dom-ready", ready);
    browser.addEventListener("did-start-loading", loading);
    browser.addEventListener("did-navigate", syncNavigation);
    browser.addEventListener("did-navigate-in-page", syncNavigation);
    browser.addEventListener("did-stop-loading", stopped);
    browser.addEventListener("console-message", consoleMessage);
    return () => {
      browser.removeEventListener("dom-ready", ready); browser.removeEventListener("did-start-loading", loading);
      browser.removeEventListener("did-navigate", syncNavigation); browser.removeEventListener("did-navigate-in-page", syncNavigation); browser.removeEventListener("did-stop-loading", stopped);
      browser.removeEventListener("console-message", consoleMessage);
    };
  }, [browserOpen, activePlatform]);

  useEffect(() => {
    if (!logOpen || !logPanelRef.current) return;
    logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
  }, [logs, logOpen]);

  async function exportProject() {
    setExporting(true); setStatus("");
    try { const outputPath = await window.aaa.projects.export(project.id); if (outputPath) setStatus(`내보내기 완료: ${outputPath}`); }
    catch (error) { setStatus(error.message); }
    finally { setExporting(false); }
  }

  async function releaseBrowserProtection() {
    const browser = browserRef.current;
    if (!protectionActive.current || !browser) return;
    protectionActive.current = false;
    await window.aaa.exportSecurity.stop({ webContentsId: browser.getWebContentsId() }).catch(() => {});
  }

  async function openBookmark(bookmark) {
    if (!bookmark.url) return;
    await releaseBrowserProtection();
    setStatus(""); setLogs([]); setLogOpen(false); setBrowserReady(false); setBrowserAddress(bookmark.url); setBrowserSource(bookmark.url); setCanGoBack(false); setCanGoForward(false); setBrowserOpen(true);
  }

  function openBrowser() {
    setStatus(""); setLogs([]); setLogOpen(false); setBrowserReady(false); setBrowserAddress("aaa://home"); setBrowserSource(BROWSER_HOME); setCanGoBack(false); setCanGoForward(false); setActivePlatform(null); setBrowserOpen(true);
  }

  function selectTemplate(id) { setSetup(null); setActivePlatform(platforms.find((item) => item.id === id) || null); }

  async function selectBookmark(id) {
    const bookmark = bookmarks.find((item) => item.id === id);
    if (!bookmark || running || !browserRef.current) return;
    await releaseBrowserProtection();
    setBookmarkMenuOpen(false);
    setBrowserAddress(bookmark.url);
    browserRef.current.loadURL(bookmark.url);
  }

  async function navigateBrowser(event) {
    event.preventDefault();
    if (running || !browserRef.current) return;
    await releaseBrowserProtection();
    let target = browserAddress.trim();
    if (target.toLowerCase() === "aaa://home") { browserRef.current.loadURL(BROWSER_HOME); return; }
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
    try {
      const parsed = new URL(target);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      setBrowserAddress(parsed.href);
      browserRef.current.loadURL(parsed.href);
    } catch { setStatus("올바른 웹 주소를 입력해 주세요."); }
  }

  async function useBrowserNavigation(action) {
    if (running || !browserRef.current) return;
    await releaseBrowserProtection();
    browserRef.current[action]?.();
  }

  async function closeBrowser() {
    if (running) return;
    await releaseBrowserProtection();
    setBrowserOpen(false);
  }

  async function prepareAutomationData() {
    const [work, titleImgRows, promptRows, lorebookRows, situationRows, assetRows, promptFolders, situationFolders, lorebookFolders] = await Promise.all([
      window.aaa.works.get(project.id),
      window.aaa.works.listImages(project.id),
      window.aaa.prompts.list(project.id),
      window.aaa.lorebooks.list(project.id),
      window.aaa.situations.list(project.id),
      window.aaa.assets.list(project.id),
      window.aaa.prompts.listFolders(project.id),
      window.aaa.situations.listFolders(project.id),
      window.aaa.lorebooks.listFolders(project.id)
    ]);
    const [promptItems, situationItems] = await Promise.all([
      Promise.all(promptRows.map((item) => window.aaa.prompts.get(item.id))),
      Promise.all(situationRows.map((item) => window.aaa.situations.get(item.id)))
    ]);
    const cleanEntry = (item) => item ? ({ id: item.id, title: item.title || "", content: item.content || "", folderId: item.folderId || "", position: Number(item.position) || 0 }) : null;
    const cleanLorebook = (item) => item ? ({ ...cleanEntry(item), keywords: item.keywords || [] }) : null;
    const groupFolders = (folderRows, items) => folderRows.map((folder) => ({ id: folder.id, name: folder.name, position: Number(folder.position) || 0, items: items.filter((item) => item.folderId === folder.id) }));
    const preparedPrompts = promptItems.map(cleanEntry);
    const preparedSituations = situationItems.map(cleanEntry);
    const preparedLorebooks = lorebookRows.map(cleanLorebook);
    const preparedAssets = applyAssetNameMode(platformAssets(project, assetRows, "internal", "origin"), "classification");
    const titleImgs = titleImgRows.filter((item) => item.savedPath).map((item) => ({ id: item.id, name: item.sourceName, file: item.savedPath }));
    const previewContext = {
      project: { name: project.name },
      work: { introduction: work?.introduction || "", characterPreference: work?.characterPreference || "ALL", ageRating: work?.ageRating || "SAFE", tags: work?.tags || [] },
      prompts: { selected: preparedPrompts[0] || null, items: preparedPrompts, folders: groupFolders(promptFolders, preparedPrompts) },
      situations: { selected: preparedSituations[0] || null, items: preparedSituations, folders: groupFolders(situationFolders, preparedSituations) },
      lorebooks: { selected: preparedLorebooks[0] || null, items: preparedLorebooks, folders: groupFolders(lorebookFolders, preparedLorebooks) },
      titleImg: { selected: titleImgs[0] || null, items: titleImgs, token: "" },
      assets: {
        enabled: true,
        items: preparedAssets,
        token: "",
        folders: groupPlatformAssetsByFolder(preparedAssets).map((folder) => ({ path: folder.path, token: "", items: folder.assets })),
        criteria: project.tags,
        pathRule: project.pathTemplate
      }
    };
    return { previewContext, preparedAssets, assetRows };
  }

  function refreshSetupAssets(variant, nameMode) {
    if (!setup || !["origin", "cleaned"].includes(variant) || !["classification", "filename"].includes(nameMode)) return;
    const preparedAssets = applyAssetNameMode(platformAssets(project, setup.assetRows, "internal", variant), nameMode);
    setSetupAssetVariant(variant);
    setSetupAssetNameMode(nameMode);
    setSetup((current) => ({
      ...current,
      preparedAssets,
      previewContext: {
        ...current.previewContext,
        assets: {
          ...current.previewContext.assets,
          items: preparedAssets,
          folders: groupPlatformAssetsByFolder(preparedAssets).map((folder) => ({ path: folder.path, token: "", items: folder.assets }))
        }
      }
    }));
  }

  function changeSetupAssetVariant(variant) { refreshSetupAssets(variant, setupAssetNameMode); }
  function changeSetupAssetNameMode(nameMode) { refreshSetupAssets(setupAssetVariant, nameMode); }

  async function openAutomationSetup() {
    if (!activePlatform || !browserReady || running || setupLoading) return;
    setSetupLoading(true); setStatus("");
    try {
      const latestPlatforms = await window.aaa.exportTemplates.list();
      const latestPlatform = latestPlatforms.find((item) => item.id === activePlatform.id);
      if (!latestPlatform) throw new Error("선택한 내보내기 템플릿을 찾을 수 없습니다.");
      const declaration = parseTemplateDeclaration(latestPlatform.script);
      const prepared = await prepareAutomationData();
      const selections = {};
      for (const input of declaration.inputs) {
        if (input.selection === "all") continue;
        if (input.selection === "choice") { selections[input.key] = input.options[0]?.value || ""; continue; }
        if (!inputIsActive(input, selections)) continue;
        const sourceValue = valueAtPath(prepared.previewContext, input.source);
        if (input.selection === "boolean") selections[input.key] = Boolean(sourceValue);
        else if (Array.isArray(sourceValue) && sourceValue.length) selections[input.key] = optionKey(sourceValue[0], 0);
      }
      setPlatforms(latestPlatforms); setActivePlatform(latestPlatform); setSetupSelections(selections);
      setSetupAssetVariant("origin");
      setSetupAssetNameMode("classification");
      setSetup({ platform: latestPlatform, declaration, ...prepared });
    } catch (error) { setStatus(`설정 준비 실패: ${error.message}`); }
    finally { setSetupLoading(false); }
  }

  function resolveDeclaredInputs(declaration, context, selections) {
    const inputs = {};
    const assetsDisabled = assetsAreDisabled(declaration, selections);
    for (const input of declaration.inputs) {
      if (!inputIsActive(input, selections)) continue;
      if (input.selection === "choice") {
        const selected = String(selections[input.key] || "");
        if (!input.options.some((option) => option.value === selected)) throw new Error(`${input.label} 항목을 선택해 주세요.`);
        inputs[input.key] = selected;
        continue;
      }
      const sourceValue = valueAtPath(context, input.source);
      if (sourceValue === undefined) throw new Error(`${input.label}의 source '${input.source}'를 찾을 수 없습니다.`);
      if (assetsDisabled && isUploadDependentAssetSource(input.source)) {
        inputs[input.key] = input.selection === "single" ? null : [];
        continue;
      }
      if (input.selection === "all") { inputs[input.key] = sourceValue; continue; }
      if (input.selection === "boolean") { inputs[input.key] = Boolean(selections[input.key]); continue; }
      if (!Array.isArray(sourceValue)) throw new Error(`${input.label}의 source는 선택 가능한 목록이 아닙니다.`);
      if (input.selection === "folder" && selections[input.key] === ALL_FOLDER_SELECTION) {
        inputs[input.key] = folderAllItems(context, input.source, sourceValue);
        continue;
      }
      const selected = sourceValue.find((item, index) => optionKey(item, index) === selections[input.key]);
      if (!selected) throw new Error(`${input.label} 항목을 선택해 주세요.`);
      if (input.selection === "single") inputs[input.key] = selected;
      else {
        const folderItems = Array.isArray(selected.items) ? selected.items : Array.isArray(selected.assets) ? selected.assets : null;
        if (!folderItems) throw new Error(`${input.label}에서 선택한 값은 폴더 형식이 아닙니다.`);
        inputs[input.key] = folderItems;
      }
    }
    return inputs;
  }

  async function runAutomation(currentSetup) {
    if (!currentSetup || !browserRef.current || !browserReady || running) return;
    const registeredUploadTokens = [];
    let securityStarted = false;
    cancelRequested.current = false;
    securityViolation.current = "";
    setSetup(null);
    setLogs([]); setRunning(true); setCancelling(false); setStatus("");
    appendLog("자동 입력을 시작했습니다.");
    const ensureNotCancelled = () => {
      if (cancelRequested.current) throw new Error("작업이 중단되었습니다.");
    };
    try {
      await browserRef.current.executeJavaScript("globalThis.__aaaExportCancelled = false");
      const latestPlatform = currentSetup.platform;
      const { preparedAssets } = currentSetup;
      const uploadEnabled = !assetsAreDisabled(currentSetup.declaration, setupSelections);
      const titleImgInput = currentSetup.declaration.inputs.find((input) => input.source === "titleImg.items" && input.selection === "single");
      const selectedTitleImg = titleImgInput
        ? currentSetup.previewContext.titleImg.items.find((item, index) => optionKey(item, index) === setupSelections[titleImgInput.key]) || null
        : currentSetup.previewContext.titleImg.selected;
      appendLog(`템플릿 설정을 적용했습니다 · ${latestPlatform.name}`);
      const assetFile = (asset) => ({ path: asset.file, name: asset.name });
      const allAssets = uploadEnabled ? preparedAssets : [];
      const assetFiles = allAssets.map(assetFile);
      const titleImgFile = selectedTitleImg?.file ? { path: selectedTitleImg.file, name: selectedTitleImg.name } : null;
      const registerUploadFiles = async (files) => {
        const token = files.length ? await window.aaa.exportFiles.register(files) : "";
        if (token) registeredUploadTokens.push(token);
        return token;
      };
      const titleImgToken = await registerUploadFiles(titleImgFile ? [titleImgFile] : []);
      const assetToken = await registerUploadFiles(assetFiles);
      const uploadHandles = new Map();
      const exposeUploadFile = (item, file) => {
        if (!item || !file) return item ? { ...item, file: "" } : null;
        const handle = `aaa-upload:${crypto.randomUUID()}`;
        uploadHandles.set(handle, file);
        return { ...item, file: handle };
      };
      const exposedTitleImg = exposeUploadFile(selectedTitleImg, titleImgFile);
      const exposedAssets = allAssets.map((asset, index) => exposeUploadFile(asset, assetFiles[index]));
      const exposedAssetByOriginal = new Map(allAssets.map((asset, index) => [asset, exposedAssets[index]]));
      const assetFolders = [];
      for (const folder of groupPlatformAssetsByFolder(allAssets)) {
        const token = await registerUploadFiles(folder.assets.map(assetFile));
        assetFolders.push({ path: folder.path, token, items: folder.assets.map((asset) => exposedAssetByOriginal.get(asset)) });
      }
      const exportAssets = {
        enabled: uploadEnabled,
        items: exposedAssets,
        token: assetToken,
        folders: assetFolders,
        criteria: project.tags,
        pathRule: project.pathTemplate
      };
      const exportTitleImg = { items: exposedTitleImg ? [exposedTitleImg] : [], selected: exposedTitleImg, token: titleImgToken };
      appendLog(`입력 데이터 준비 완료 · 타이틀 이미지 ${selectedTitleImg ? 1 : 0}장 · 에셋 ${assetFiles.length}장 · 에셋 폴더 ${assetFolders.length}개`);
      const selectionContext = {
        ...currentSetup.previewContext,
        titleImg: exportTitleImg,
        assets: exportAssets
      };
      const inputs = resolveDeclaredInputs(currentSetup.declaration, selectionContext, setupSelections);
      const context = {
        project: { name: selectionContext.project.name },
        work: selectionContext.work,
        prompts: { selected: null, items: [], folders: [] },
        situations: { selected: null, items: [], folders: [] },
        lorebooks: { selected: null, items: [], folders: [] },
        titleImg: exportTitleImg,
        assets: exportAssets,
        inputs
      };
      const security = await window.aaa.exportSecurity.start({
        webContentsId: browserRef.current.getWebContentsId(),
        uploadCount: assetFiles.length + (titleImgFile ? 1 : 0),
        operationCount: countSelectedOperations(inputs)
      });
      protectionActive.current = true;
      securityStarted = true;
      appendLog(`보호 모드를 적용했습니다 · 요청 한도 ${security.requestLimit}회`);
      const source = `(async () => { globalThis.__aaaExportRequest = null; const data = ${JSON.stringify(context)}; const { project, work, prompts, situations, lorebooks, titleImg, assets, inputs } = data; const splitOnce = (content, separator) => { const text = String(content ?? ""); const marker = String(separator ?? ""); if (!marker) return { before: text, after: "", found: false }; const index = text.indexOf(marker); return index < 0 ? { before: text, after: "", found: false } : { before: text.slice(0, index), after: text.slice(index + marker.length), found: true }; };\n{\n${latestPlatform.script || ""}\n}\nreturn globalThis.__aaaExportRequest;\n})()`;
      let result = await browserRef.current.executeJavaScript(source, true);
      ensureNotCancelled();
      let uploadRequestCount = 0;
      while (result?.fileSelector && (result?.uploadToken || Array.isArray(result?.assetFiles))) {
        uploadRequestCount += 1;
        if (uploadRequestCount > 10) throw new Error("연속 이미지 업로드 요청이 너무 많습니다.");
        if (result.uploadToken && Array.isArray(result.assetFiles)) throw new Error("에셋 업로드 요청에는 uploadToken과 assetFiles 중 하나만 사용할 수 있습니다.");
        let uploadToken = result.uploadToken || "";
        let uploadCount = 0;
        if (Array.isArray(result.assetFiles)) {
          const requestedFiles = result.assetFiles.map((handle) => uploadHandles.get(String(handle || "")));
          if (requestedFiles.some((file) => !file)) throw new Error("내보내기 코드가 프로젝트에 없는 에셋 파일을 요청했습니다.");
          uploadToken = await registerUploadFiles(requestedFiles);
          uploadCount = requestedFiles.length;
        } else {
          const selectedUpload = uploadToken === exportTitleImg.token ? { items: titleImgFile ? [titleImgFile] : [] } : uploadToken === exportAssets.token ? { items: assetFiles } : exportAssets.folders.find((folder) => folder.token === uploadToken);
          if (!selectedUpload) throw new Error("내보내기 코드가 유효하지 않은 에셋 업로드 토큰을 반환했습니다.");
          uploadCount = selectedUpload.items.length;
        }
        if (!uploadToken) throw new Error("업로드할 에셋이 없습니다.");
        appendLog(`파일 ${uploadCount}장을 브라우저에 전달하고 있습니다.`);
        await window.aaa.exportFiles.setInput({ token: uploadToken, webContentsId: browserRef.current.getWebContentsId(), selector: result.fileSelector });
        ensureNotCancelled();
        await browserRef.current.executeJavaScript(`(() => { const input = document.querySelector(${JSON.stringify(result.fileSelector)}); if (input) { input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); } })()`);
        appendLog("파일 선택을 전달했습니다. 업로드 카드 생성을 기다립니다.");
        if (result.afterUploadScript) result = await browserRef.current.executeJavaScript(result.afterUploadScript, true);
        else {
          if (result.nextTab) await browserRef.current.executeJavaScript(`(() => { const label = ${JSON.stringify(result.nextTab)}; [...document.querySelectorAll('button[role="tab"]')].find((button) => button.textContent.trim() === label)?.click(); })()`);
          result = null;
        }
        ensureNotCancelled();
      }
      ensureNotCancelled();
      appendLog("자동 입력이 완료되었습니다.");
      setStatus(securityViolation.current ? `보안 차단: ${securityViolation.current}` : "자동 입력이 완료되었습니다. 내용을 확인해 주세요.");
    } catch (error) {
      if (cancelRequested.current || String(error.message).includes("작업이 중단되었습니다")) { appendLog("사용자가 작업을 중단했습니다."); setStatus("자동 입력을 중단했습니다."); }
      else { appendLog(`오류: ${error.message}`); setStatus(`자동 입력 실패: ${error.message}`); }
    } finally {
      if (registeredUploadTokens.length) await window.aaa.exportFiles.discard(registeredUploadTokens).catch(() => {});
      if (securityStarted && browserRef.current) await window.aaa.exportSecurity.finish({ webContentsId: browserRef.current.getWebContentsId() }).catch(() => {});
      setRunning(false); setCancelling(false);
    }
  }

  async function cancelAutomation() {
    if (!running || cancelling) return;
    cancelRequested.current = true;
    setCancelling(true);
    setStatus("자동 입력 중단 중…");
    appendLog("중단 요청을 보냈습니다.");
    try { await browserRef.current?.executeJavaScript("globalThis.__aaaExportCancelled = true"); }
    catch {}
  }

  if (browserOpen) return <div className="platform-browser-workspace">
    <section className="platform-browser-main">
      <header className="platform-browser-workbar"><button className="outline-button icon-button" aria-label="플랫폼 브라우저 닫기" title="닫기" disabled={running} onClick={closeBrowser}><X size={18} /></button><div><select aria-label="자동입력 템플릿" value={activePlatform?.id || ""} disabled={running || setupLoading} onChange={(event) => selectTemplate(event.target.value)}><option value="">템플릿 선택</option>{platforms.filter((platform) => !platform.folderId).map((platform) => <option value={platform.id} key={platform.id}>{platform.name}</option>)}{platformFolders.map((folder) => <optgroup label={folder.name} key={folder.id}>{platforms.filter((platform) => platform.folderId === folder.id).map((platform) => <option value={platform.id} key={platform.id}>{platform.name}</option>)}</optgroup>)}</select><button className="primary-button button-with-icon" disabled={!activePlatform || !browserReady || running || setupLoading} onClick={openAutomationSetup}>{setupLoading ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}{setupLoading ? "설정 준비 중" : "실행"}</button></div></header>
      <form className="platform-browser-navigation" onSubmit={navigateBrowser}>
        <button type="button" className="browser-navigation-button" aria-label="웹페이지 뒤로" title="뒤로" disabled={!canGoBack || running} onClick={() => useBrowserNavigation("goBack")}><ArrowLeft size={17} /></button>
        <button type="button" className="browser-navigation-button" aria-label="웹페이지 앞으로" title="앞으로" disabled={!canGoForward || running} onClick={() => useBrowserNavigation("goForward")}><ArrowRight size={17} /></button>
        <button type="button" className="browser-navigation-button" aria-label="웹페이지 새로고침" title="새로고침" disabled={running} onClick={() => useBrowserNavigation("reload")}><RotateCw size={16} /></button>
        <input aria-label="웹페이지 주소" value={browserAddress} disabled={running} spellCheck="false" onChange={(event) => setBrowserAddress(event.target.value)} />
        <button type="button" className={`browser-navigation-button browser-bookmark-button ${bookmarkMenuOpen ? "active" : ""}`} aria-label="즐겨찾기" title="즐겨찾기" disabled={running} onClick={() => setBookmarkMenuOpen((current) => !current)}><Bookmark size={16} /></button>
        {bookmarkMenuOpen && <div className="browser-bookmark-menu">{bookmarks.length ? bookmarks.map((bookmark) => <button type="button" key={bookmark.id} onClick={() => selectBookmark(bookmark.id)}><strong>{bookmark.name}</strong></button>) : <p>등록된 즐겨찾기가 없습니다.</p>}</div>}
      </form>
      {logOpen && <section className="platform-browser-log"><header><strong>실시간 작업 로그</strong><button className="icon-button" aria-label="작업 로그 닫기" title="닫기" onClick={() => setLogOpen(false)}><X size={15} /></button></header><div ref={logPanelRef}>{logs.length ? logs.map((entry) => <p key={entry.id}><time>{entry.time}</time><span>{entry.message}</span></p>) : <p className="empty">아직 기록된 작업이 없습니다.</p>}</div></section>}
      <div className="platform-browser-frame">
        <webview ref={browserRef} src={browserSource} partition="persist:aaa-platform-browser" allowpopups="true" />
        {running && <div className="platform-browser-lock"><LoaderCircle className="spin" size={30} /><strong>{cancelling ? "자동 입력을 중단하는 중입니다." : "자동 입력 중입니다."}</strong>{logs.length > 0 && <span>{logs.at(-1).message}</span>}<button className="danger-button button-with-icon" disabled={cancelling} onClick={cancelAutomation}><Square size={14} fill="currentColor" />{cancelling ? "중단 중" : "작업 중단"}</button></div>}
      </div>
      <div className={`platform-browser-status ${status.includes("완료") ? "success" : status ? "error" : ""}`}><span title={status || logs.at(-1)?.message || "대기 중"}>{status || logs.at(-1)?.message || "대기 중"}</span><button className={`icon-button ${logOpen ? "active" : ""}`} aria-label="작업 로그" title="작업 로그" onClick={() => setLogOpen((current) => !current)}><ListTree size={15} /></button></div>
    </section>
    {setup && <ExportSetupModal setup={setup} selections={setupSelections} assetVariant={setupAssetVariant} assetNameMode={setupAssetNameMode} onAssetVariantChange={changeSetupAssetVariant} onAssetNameModeChange={changeSetupAssetNameMode} onChange={(key, value) => setSetupSelections((current) => ({ ...current, [key]: value }))} onClose={() => setSetup(null)} onRun={() => runAutomation(setup)} />}
  </div>;

  return <div className="export-page">
    <section className="export-section"><div className="export-section-heading"><h2>파일로 내보내기</h2></div><div className="export-list"><article className="export-list-item"><div className="export-item-icon"><FolderArchive size={22} /></div><div className="export-item-content"><strong>프로젝트 ZIP</strong><span>프로젝트를 ZIP파일로 저장합니다.</span></div><button className="primary-button editor-icon-button export-item-action" aria-label="다운로드" data-tooltip="다운로드" disabled={exporting} onClick={exportProject}><Download size={18} /></button></article></div>{status && <p className={`export-status ${status.startsWith("내보내기 완료") ? "success" : "error"}`}>{status}</p>}</section>
    <section className="export-section"><div className="export-section-heading"><h2>플랫폼에 내보내기</h2><p>이 기능은 플랫폼과 연관없는 비공식 기능으로, 완전한 작동을 보장하지 않습니다. 해당 플랫폼의 약관 위반, 프로그램의 동작 오류 등으로 인한 위험에 책임지지 않습니다.</p><p>템플릿 코드는 반드시 검증이 된 것을 사용하시고, 검증되지 않은 코드에 의한 피해는 사용자 본인의 책임입니다.</p><p>작품 공개/배포 전에는 직접 확인을 필요로 합니다.</p></div><div className="export-list"><article className="export-list-item"><div className="export-item-icon"><Globe size={22} /></div><div className="export-item-content"><strong>플랫폼에 내보내기</strong><span>플랫폼에 접속하여 프로젝트 데이터를 자동 입력합니다.</span></div><button className="primary-button editor-icon-button export-item-action" aria-label="업로드" data-tooltip="업로드" onClick={openBrowser}><Upload size={18} /></button></article></div><div className="platform-shortcut-grid">{bookmarks.length ? bookmarks.map((bookmark) => <article className="platform-shortcut-card" key={bookmark.id}><div><strong>{bookmark.name}</strong><span>{bookmark.url}</span></div><button className="outline-button button-with-icon" onClick={() => openBookmark(bookmark)}><ExternalLink size={16} />바로가기</button></article>) : <div className="platform-empty-state"><Bookmark size={32} /><strong>등록된 즐겨찾기 없음</strong></div>}</div></section>
  </div>;
}

export { ExportProject };
