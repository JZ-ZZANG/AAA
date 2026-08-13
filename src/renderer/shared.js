const EXTENSIONS = [".png", ".webp", ".jpg", ".jpeg", ".avif", ".gif"];
const ORIGINAL_EXTENSION = "original";
const TRACKED_EXTENSIONS = [...EXTENSIONS, ".bmp"];
const DEFAULT_SHORTCUTS = { home: "F1", management: "F2", classification: "F3", censorship: "F4", progress: "F5" };
const DEFAULT_CENSOR_SHORTCUTS = { previous: "Z", next: "C", undo: "Ctrl+Z", brushIncrease: "WheelUp", brushDecrease: "WheelDown", hardnessIncrease: "Ctrl+WheelUp", hardnessDecrease: "Ctrl+WheelDown", opacityIncrease: "Shift+WheelUp", opacityDecrease: "Shift+WheelDown", zoomIncrease: "Alt+WheelUp", zoomDecrease: "Alt+WheelDown", lineModifier: "shift" };
const DEFAULT_CENSORSHIP = { targets: ["nipple", "penis", "vulva", "anus"], confidence: 50, imageSize: 640, dilation: 8, method: "solid", shape: "circle", color: "#ffffff", size: 48, hardness: 80, opacity: 100, modelPath: "" };
const censorEditFlushers = new Set();

function registerCensorEditFlusher(flush) {
  censorEditFlushers.add(flush);
  return () => censorEditFlushers.delete(flush);
}

async function flushCensorEdits() {
  await Promise.all([...censorEditFlushers].map((flush) => flush()));
}

function shortcutFromEvent(event) {
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return "";
  return `${event.ctrlKey ? "Ctrl+" : ""}${event.shiftKey ? "Shift+" : ""}${event.altKey ? "Alt+" : ""}${event.key.length === 1 ? event.key.toUpperCase() : event.key}`;
}

function matchesShortcut(event, shortcut) { return shortcutFromEvent(event).toLowerCase() === shortcut.toLowerCase(); }
function savedShortcuts() { try { return { ...DEFAULT_SHORTCUTS, ...JSON.parse(localStorage.getItem("aaa-preferences") || "{}").shortcuts }; } catch { return DEFAULT_SHORTCUTS; } }
function savedCensorShortcuts() { try { return { ...DEFAULT_CENSOR_SHORTCUTS, ...JSON.parse(localStorage.getItem("aaa-preferences") || "{}").censorShortcuts }; } catch { return DEFAULT_CENSOR_SHORTCUTS; } }
function savedCensorshipSettings() { try { return { ...DEFAULT_CENSORSHIP, ...JSON.parse(localStorage.getItem("aaa-preferences") || "{}").censorship }; } catch { return DEFAULT_CENSORSHIP; } }

function wheelShortcutFromEvent(event) {
  return `${event.ctrlKey ? "Ctrl+" : ""}${event.shiftKey ? "Shift+" : ""}${event.altKey ? "Alt+" : ""}${event.deltaY < 0 ? "WheelUp" : "WheelDown"}`;
}

function matchesInputShortcut(event, shortcut) {
  const current = event.type === "wheel" ? wheelShortcutFromEvent(event) : shortcutFromEvent(event);
  return current.toLowerCase() === shortcut.toLowerCase();
}

function editableRule(template, tags) {
  if (!template) return "";
  let value = template.endsWith(".{extension}") ? template.slice(0, -".{extension}".length) : template.replaceAll("{extension}", "");
  if (value.endsWith("extension")) value = value.slice(0, -"extension".length);
  if (value.endsWith(".")) value = value.slice(0, -1);
  tags.forEach((tag) => { value = value.replaceAll(`{tag:${tag.id}}`, `{${tag.name}}`); });
  return value;
}

function storedRule(ruleText, tags) {
  let value = ruleText.trim();
  tags.forEach((tag) => { value = value.replaceAll(`{${tag.name}}`, `{tag:${tag.id}}`); });
  return value ? `${value}.{extension}` : "";
}

function normalizeProject(project) {
  if (!project) return project;
  return {
    ...project,
    censorshipConfig: { enabled: project.censorshipConfig?.enabled === true, targets: ["nipple", "penis", "vulva", "anus"], method: project.censorshipConfig?.method === "block" ? "solid" : project.censorshipConfig?.method || "solid", color: "#ffffff", modelPath: "", outputExtension: ".png", ...project.censorshipConfig, outputPath: undefined, ...(project.censorshipConfig?.method === "block" ? { method: "solid" } : {}) },
    tags: (project.tags || []).map((tag) => ({
      ...tag,
      values: (tag.values || []).map((item) => {
        if (item.label) return item;
        const separator = item.value.indexOf("=");
        return separator > 0
          ? { ...item, label: item.value.slice(0, separator).trim(), value: item.value.slice(separator + 1).trim() }
          : { ...item, label: item.value };
      })
    }))
  };
}

function combinations(tags) {
  return tags.reduce(
    (rows, tag) => rows.flatMap((row) => tag.values.map((value) => ({ selections: { ...row.selections, [tag.id]: value.id }, labels: [...row.labels, value.label || value.value] }))),
    [{ selections: {}, labels: [] }]
  );
}

function renderPath(project, selections, extension = "") {
  let result = extension
    ? project.pathTemplate.replaceAll("{extension}", extension)
    : project.pathTemplate.replaceAll(".{extension}", "").replaceAll("{extension}", "");
  project.tags.forEach((tag) => {
    const value = tag.values.find((item) => item.id === selections[tag.id])?.value || "";
    result = result.replaceAll(`{tag:${tag.id}}`, value);
  });
  return result.replaceAll("/", "\\");
}

function findPathRuleCollision(project) {
  const template = String(project?.pathTemplate || "");
  const tagIds = [...new Set([...template.matchAll(/\{tag:([^}]+)\}/g)].map((match) => match[1]))];
  const tags = tagIds.map((id) => project.tags.find((tag) => tag.id === id)).filter(Boolean);
  const seen = new Map();
  let collision = null;
  const visit = (index, rendered, selections) => {
    if (collision) return;
    if (index >= tags.length) {
      const finalPath = rendered.replaceAll("{extension}", "png").replaceAll("\\", "/").replace(/\/+/g, "/");
      const key = finalPath.toLowerCase();
      const previous = seen.get(key);
      if (previous) collision = { path: finalPath, first: previous, second: selections };
      else seen.set(key, selections);
      return;
    }
    const tag = tags[index];
    for (const option of tag.values || []) {
      visit(index + 1, rendered.replaceAll(`{tag:${tag.id}}`, String(option.value ?? "")), [...selections, `${tag.name}=${option.label}`]);
    }
  };
  visit(0, template, []);
  return collision;
}

function withoutExtension(filePath) {
  return filePath.replace(/\.[^\\/.]+$/, "").toLowerCase();
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesProjectPath(project, relativePath) {
  if (!project?.pathTemplate || !Array.isArray(project.tags)) return false;
  let template = project.pathTemplate.replaceAll("\\", "/").replaceAll(".{extension}", "").replaceAll("{extension}", "");
  let pattern = escapeRegularExpression(template);
  for (const tag of project.tags) {
    const values = Array.isArray(tag.values) ? tag.values.map((item) => escapeRegularExpression(String(item.value).replaceAll("\\", "/"))) : [];
    if (!values.length && template.includes(`{tag:${tag.id}}`)) return false;
    pattern = pattern.replaceAll(escapeRegularExpression(`{tag:${tag.id}}`), `(?:${values.join("|")})`);
  }
  if (/\\\{tag:/.test(pattern)) return false;
  return new RegExp(`^${pattern}$`, "i").test(withoutExtension(relativePath).replaceAll("\\", "/"));
}

function assetClassification(project, relativePath) {
  if (!project?.pathTemplate || !Array.isArray(project.tags)) return { name: relativePath, classification: {} };
  const tokenPattern = /\{tag:([^}]+)\}|\{extension\}/g;
  const tagIds = [];
  let cursor = 0;
  let pattern = "^";
  const normalizedTemplate = project.pathTemplate.replaceAll("\\", "/");
  for (const match of normalizedTemplate.matchAll(tokenPattern)) {
    pattern += escapeRegularExpression(normalizedTemplate.slice(cursor, match.index));
    if (match[1]) {
      tagIds.push(match[1]);
      const tag = project.tags.find((item) => item.id === match[1]);
      const storedValues = (tag?.values || []).map((item) => String(item.value ?? "")).sort((left, right) => right.length - left.length);
      if (!storedValues.length) return { name: withoutExtension(relativePath), classification: {} };
      pattern += `(${storedValues.map(escapeRegularExpression).join("|")})`;
    }
    else pattern += "[^./]+";
    cursor = match.index + match[0].length;
  }
  pattern += `${escapeRegularExpression(normalizedTemplate.slice(cursor))}$`;
  const values = new RegExp(pattern, "i").exec(String(relativePath).replaceAll("\\", "/"));
  if (!values) return { name: withoutExtension(relativePath), classification: {} };
  const classification = {};
  const labels = tagIds.map((tagId, index) => {
    const tag = project.tags.find((item) => item.id === tagId);
    const storedValue = values[index + 1];
    const option = tag?.values?.find((item) => String(item.value).toLowerCase() === storedValue.toLowerCase());
    const label = option?.label || option?.value || storedValue;
    classification[tag?.name || tagId] = label;
    return storedValue === "" ? "" : label;
  });
  return { name: labels.filter(Boolean).join("/"), classification };
}

function platformAssets(project, assets, mode, variant) {
  if (mode === "external") return [];
  return (assets || []).filter((asset) => matchesProjectPath(project, asset.relativePath)).flatMap((asset) => {
    const file = variant === "cleaned" ? asset.cleanedPath : asset.savedPath;
    if (!file) return [];
    return [{ ...assetClassification(project, asset.relativePath), relativePath: asset.relativePath, file }];
  });
}

function groupPlatformAssetsByFolder(assets) {
  const folders = new Map();
  for (const asset of assets || []) {
    const normalized = String(asset.relativePath || "").replaceAll("\\", "/");
    const separator = normalized.lastIndexOf("/");
    const directory = separator < 0 ? "" : normalized.slice(0, separator);
    const paths = directory ? ["", ...directory.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"))] : [""];
    for (const path of paths) {
      if (!folders.has(path)) folders.set(path, []);
      folders.get(path).push(asset);
    }
  }
  return [...folders].map(([path, folderAssets]) => ({
    path,
    name: path ? path.split("/").at(-1) : "루트",
    count: folderAssets.length,
    assets: folderAssets
  }));
}

export { EXTENSIONS, ORIGINAL_EXTENSION, TRACKED_EXTENSIONS, DEFAULT_SHORTCUTS, DEFAULT_CENSOR_SHORTCUTS, DEFAULT_CENSORSHIP, shortcutFromEvent, matchesShortcut, savedShortcuts, savedCensorShortcuts, savedCensorshipSettings, wheelShortcutFromEvent, matchesInputShortcut, editableRule, storedRule, normalizeProject, combinations, renderPath, findPathRuleCollision, withoutExtension, matchesProjectPath, assetClassification, platformAssets, groupPlatformAssetsByFolder, registerCensorEditFlusher, flushCensorEdits };
