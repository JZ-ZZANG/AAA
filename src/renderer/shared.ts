const EXTENSIONS = [".png", ".webp", ".jpg", ".jpeg", ".avif", ".gif"];
const ORIGINAL_EXTENSION = "original";
const TRACKED_EXTENSIONS = [...EXTENSIONS, ".bmp"];
const DEFAULT_SHORTCUTS = {
  home: "F1",
  management: "F2",
  work: "F3",
  prompts: "F4",
  lorebook: "F5",
  situation: "F6",
  classification: "F7",
  censorship: "F8",
  export: "F9",
  settings: "F12"
};
const DEFAULT_CENSOR_SHORTCUTS = { previous: "Z", manualToggle: "X", next: "C", originalPreview: "Q", brushEraserToggle: "A", methodCycle: "S", shapeToggle: "D", sidebarToggle: "/", undo: "Ctrl+Z", redo: "Ctrl+Y", brushIncrease: "WheelUp", brushDecrease: "WheelDown", hardnessIncrease: "Ctrl+WheelUp", hardnessDecrease: "Ctrl+WheelDown", opacityIncrease: "Shift+WheelUp", opacityDecrease: "Shift+WheelDown", zoomIncrease: "Alt+WheelUp", zoomDecrease: "Alt+WheelDown", lineModifier: "shift" };
const CENSOR_TARGET_OPTIONS: Array<[string, string]> = [["nipple", "유두"], ["vulva", "여성기"], ["anus", "항문"], ["penis", "남성기"], ["testicles", "고환"], ["x_ray", "엑스레이"], ["cross_section", "단면"]];
const DEFAULT_CENSORSHIP = { targets: CENSOR_TARGET_OPTIONS.map(([value]) => value), confidence: 50, imageSize: 1024, dilation: 8, method: "solid", shape: "circle", color: "#ffffff", size: 48, hardness: 80, opacity: 100, modelPath: "" };
const DEFAULT_STICKERS = { favoriteEmojiIds: [] };
const censorEditFlushers = new Set<() => unknown>();

function registerCensorEditFlusher(flush) {
  censorEditFlushers.add(flush);
  return () => { censorEditFlushers.delete(flush); };
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
    censorshipConfig: { enabled: project.censorshipConfig?.enabled === true, targets: CENSOR_TARGET_OPTIONS.map(([value]) => value), method: project.censorshipConfig?.method === "block" ? "solid" : project.censorshipConfig?.method || "solid", color: "#ffffff", modelPath: "", outputExtension: ".png", ...project.censorshipConfig, outputPath: undefined, ...(project.censorshipConfig?.method === "block" ? { method: "solid" } : {}) },
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

function combinations(tags: any[]): any[] {
  return tags.reduce<any[]>(
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

export { EXTENSIONS, ORIGINAL_EXTENSION, TRACKED_EXTENSIONS, DEFAULT_SHORTCUTS, DEFAULT_CENSOR_SHORTCUTS, CENSOR_TARGET_OPTIONS, DEFAULT_CENSORSHIP, DEFAULT_STICKERS, shortcutFromEvent, matchesShortcut, savedShortcuts, savedCensorShortcuts, savedCensorshipSettings, wheelShortcutFromEvent, matchesInputShortcut, editableRule, storedRule, normalizeProject, combinations, renderPath, findPathRuleCollision, withoutExtension, matchesProjectPath, registerCensorEditFlusher, flushCensorEdits };
