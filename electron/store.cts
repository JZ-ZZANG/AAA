const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const path = require("node:path");

function logicalKey(relativePath) {
  const extension = path.extname(relativePath);
  return relativePath.slice(0, relativePath.length - extension.length).replaceAll("\\", "/").toLowerCase();
}

function parseLorebookKeywords(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((keyword) => typeof keyword === "string" && keyword.trim()).map((keyword) => keyword.trim());
  } catch {}
  return value.split(",").map((keyword) => keyword.trim()).filter(Boolean);
}

class Store {
  db: any;

  constructor(databasePath) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        save_path TEXT NOT NULL,
        external_tracking INTEGER NOT NULL DEFAULT 0,
        censorship_config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tag_values (
        id TEXT PRIMARY KEY,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        value TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS path_rules (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        template TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS prompts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS prompts_project_updated ON prompts(project_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS situations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS situations_project_updated ON situations(project_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        group_name TEXT NOT NULL DEFAULT '',
        folder_id TEXT NOT NULL DEFAULT '',
        keywords TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS templates_type_position ON templates(type, position ASC, created_at ASC);
      CREATE TABLE IF NOT EXISTS template_folders (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS template_folders_type_position ON template_folders(type, position ASC, created_at ASC);
      CREATE TABLE IF NOT EXISTS project_entry_folders (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS project_entry_folders_project_type_position ON project_entry_folders(project_id, type, position ASC, created_at ASC);
      CREATE TABLE IF NOT EXISTS lorebooks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        keywords TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS lorebooks_project_updated ON lorebooks(project_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS works (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, introduction TEXT NOT NULL DEFAULT '', character_preference TEXT NOT NULL DEFAULT 'ALL', age_rating TEXT NOT NULL DEFAULT 'SAFE', tags TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS work_title_images (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_name TEXT NOT NULL, saved_path TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS work_title_images_project_position ON work_title_images(project_id, position ASC);
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_name TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        saved_path TEXT NOT NULL,
        file_size INTEGER NOT NULL DEFAULT 0,
        modified_at REAL NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        review_status TEXT NOT NULL DEFAULT 'unreviewed',
        cleaned_path TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assets_project_created ON assets(project_id, created_at DESC);
    `);
    const ensureProjectEntryPositions = (table) => {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
      if (columns.some((column) => column.name === "position")) return;
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
      const projectIds = this.db.prepare(`SELECT DISTINCT project_id AS projectId FROM ${table}`).all();
      const list = this.db.prepare(`SELECT id FROM ${table} WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC`);
      const update = this.db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
      projectIds.forEach(({ projectId }) => list.all(projectId).forEach(({ id }, position) => update.run(position, id)));
    };
    ensureProjectEntryPositions("prompts");
    ensureProjectEntryPositions("situations");
    const ensureFolderId = (table) => {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some((column) => column.name === "folder_id")) this.db.exec(`ALTER TABLE ${table} ADD COLUMN folder_id TEXT NOT NULL DEFAULT ''`);
    };
    ensureFolderId("prompts");
    ensureFolderId("situations");
    ensureFolderId("lorebooks");
    this.db.exec("CREATE INDEX IF NOT EXISTS prompts_project_position ON prompts(project_id, position ASC); CREATE INDEX IF NOT EXISTS situations_project_position ON situations(project_id, position ASC);");
    const workColumns = this.db.prepare("PRAGMA table_info(works)").all();
    if (!workColumns.some((column) => column.name === "character_preference")) this.db.exec("ALTER TABLE works ADD COLUMN character_preference TEXT NOT NULL DEFAULT 'ALL'");
    if (!workColumns.some((column) => column.name === "age_rating")) this.db.exec("ALTER TABLE works ADD COLUMN age_rating TEXT NOT NULL DEFAULT 'SAFE'");
    this.db.exec("UPDATE works SET character_preference = 'ALL' WHERE character_preference = '전체'; UPDATE works SET character_preference = 'MALE' WHERE character_preference = '남성향'; UPDATE works SET character_preference = 'FEMALE' WHERE character_preference = '여성향'; UPDATE works SET age_rating = 'SAFE' WHERE age_rating = '전체 이용가'; UPDATE works SET age_rating = 'UNSAFE' WHERE age_rating = '미성년자 이용불가';");
    const lorebookColumns = this.db.prepare("PRAGMA table_info(lorebooks)").all();
    if (!lorebookColumns.some((column) => column.name === "position")) this.db.exec("ALTER TABLE lorebooks ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    const templateColumns = this.db.prepare("PRAGMA table_info(templates)").all();
    if (!templateColumns.some((column) => column.name === "group_name")) this.db.exec("ALTER TABLE templates ADD COLUMN group_name TEXT NOT NULL DEFAULT ''");
    if (!templateColumns.some((column) => column.name === "folder_id")) this.db.exec("ALTER TABLE templates ADD COLUMN folder_id TEXT NOT NULL DEFAULT ''");
    const legacyGroups = this.db.prepare("SELECT DISTINCT group_name AS name FROM templates WHERE type = 'lorebook' AND group_name <> '' AND folder_id = ''").all();
    legacyGroups.forEach(({ name }) => {
      let folder = this.db.prepare("SELECT id FROM template_folders WHERE type = 'lorebook' AND name = ?").get(name);
      if (!folder) {
        const id = crypto.randomUUID();
        const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM template_folders WHERE type = 'lorebook'").get().position);
        this.db.prepare("INSERT INTO template_folders (id, type, name, position, created_at) VALUES (?, 'lorebook', ?, ?, ?)").run(id, name, position, new Date().toISOString());
        folder = { id };
      }
      this.db.prepare("UPDATE templates SET folder_id = ? WHERE type = 'lorebook' AND group_name = ? AND folder_id = ''").run(folder.id, name);
    });
  }

  listProjects() {
    return this.db.prepare(`
      SELECT p.id, p.name, p.save_path AS savePath, p.updated_at AS updatedAt,
             p.external_tracking AS externalTracking,
             COUNT(a.id) AS assetCount
      FROM projects p LEFT JOIN assets a ON a.project_id = p.id
      GROUP BY p.id ORDER BY p.updated_at DESC
    `).all().map((row) => ({ ...row, assetCount: Number(row.assetCount), externalTracking: Boolean(row.externalTracking) }));
  }

  touchProject(projectId, updatedAt = new Date().toISOString()) {
    const result = this.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(updatedAt, projectId);
    return Number(result.changes) > 0;
  }

  createProject({ name, savePath, censorshipConfig = {} }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO projects (id, name, save_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, name, savePath, now, now);
    this.db.prepare("UPDATE projects SET censorship_config = ? WHERE id = ?").run(JSON.stringify(censorshipConfig), id);
    this.db.prepare("INSERT INTO path_rules (project_id, template) VALUES (?, '')").run(id);
    return this.getProject(id);
  }

  deleteProject(id) {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    return true;
  }

  getProject(id) {
    const project = this.db.prepare("SELECT id, name, save_path AS savePath, updated_at AS updatedAt, external_tracking AS externalTracking, censorship_config AS censorshipConfig FROM projects WHERE id = ?").get(id);
    if (!project) return null;
    project.externalTracking = Boolean(project.externalTracking);
    try { project.censorshipConfig = JSON.parse(project.censorshipConfig || "{}"); } catch { project.censorshipConfig = {}; }
    const tags = this.db.prepare("SELECT id, name FROM tags WHERE project_id = ? ORDER BY position").all(id);
    const valueStatement = this.db.prepare("SELECT id, label, value FROM tag_values WHERE tag_id = ? ORDER BY position");
    project.tags = tags.map((tag) => ({ ...tag, values: valueStatement.all(tag.id) }));
    project.pathTemplate = this.db.prepare("SELECT template FROM path_rules WHERE project_id = ?").get(id)?.template || "";
    return project;
  }

  saveProject({ id, name, savePath, tags, pathTemplate, externalTracking, censorshipConfig = {} }) {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE projects SET name = ?, save_path = ?, external_tracking = ?, censorship_config = ?, updated_at = ? WHERE id = ?")
        .run(name, savePath, externalTracking ? 1 : 0, JSON.stringify(censorshipConfig), now, id);
      this.db.prepare("DELETE FROM tags WHERE project_id = ?").run(id);
      const insertTag = this.db.prepare("INSERT INTO tags (id, project_id, name, position) VALUES (?, ?, ?, ?)");
      const insertValue = this.db.prepare("INSERT INTO tag_values (id, tag_id, label, value, position) VALUES (?, ?, ?, ?, ?)");
      tags.forEach((tag, tagIndex) => {
        insertTag.run(tag.id, id, tag.name, tagIndex);
        tag.values.forEach((item, valueIndex) => insertValue.run(item.id, tag.id, item.label || item.value, item.value, valueIndex));
      });
      this.db.prepare(`
        INSERT INTO path_rules (project_id, template) VALUES (?, ?)
        ON CONFLICT(project_id) DO UPDATE SET template = excluded.template
      `).run(id, pathTemplate);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getProject(id);
  }

  listPrompts(projectId) {
    return this.db.prepare("SELECT p.id, p.project_id AS projectId, p.title, p.folder_id AS folderId, f.name AS folderName, p.position, p.created_at AS createdAt, p.updated_at AS updatedAt FROM prompts p LEFT JOIN project_entry_folders f ON f.id = p.folder_id AND f.project_id = p.project_id AND f.type = 'prompt' WHERE p.project_id = ? ORDER BY p.position ASC, p.created_at ASC").all(projectId).map((entry) => ({ ...entry, folderId: entry.folderId || "", folderName: entry.folderName || "", position: Number(entry.position) }));
  }

  getPrompt(id) {
    const entry = this.db.prepare("SELECT p.id, p.project_id AS projectId, p.title, p.content, p.folder_id AS folderId, f.name AS folderName, p.position, p.created_at AS createdAt, p.updated_at AS updatedAt FROM prompts p LEFT JOIN project_entry_folders f ON f.id = p.folder_id AND f.project_id = p.project_id AND f.type = 'prompt' WHERE p.id = ?").get(id);
    return entry ? { ...entry, folderId: entry.folderId || "", folderName: entry.folderName || "", position: Number(entry.position) } : null;
  }

  createPrompt(projectId) {
    const titles = this.db.prepare("SELECT title FROM prompts WHERE project_id = ?").all(projectId).map((prompt) => prompt.title);
    const numbers = titles.map((title) => /^새 프롬프트 (\d+)$/.exec(title)?.[1]).filter(Boolean).map(Number);
    const title = `새 프롬프트 ${String(Math.max(0, ...numbers) + 1).padStart(2, "0")}`;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM prompts WHERE project_id = ?").get(projectId).position);
    this.db.prepare("INSERT INTO prompts (id, project_id, title, content, position, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?)").run(id, projectId, title, position, now, now);
    this.touchProject(projectId, now);
    return this.getPrompt(id);
  }

  duplicatePrompt(id, projectId) {
    const source = this.getPrompt(id);
    if (!source || source.projectId !== projectId) return null;
    const titles = this.db.prepare("SELECT title FROM prompts WHERE project_id = ?").all(projectId).map((prompt) => prompt.title);
    const baseTitle = `${source.title} 사본`;
    let title = baseTitle;
    let number = 2;
    while (titles.includes(title)) title = `${baseTitle} ${number++}`;
    const copyId = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM prompts WHERE project_id = ?").get(projectId).position);
    this.db.prepare("INSERT INTO prompts (id, project_id, title, content, folder_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(copyId, projectId, title, source.content, source.folderId || "", position, now, now);
    this.touchProject(projectId, now);
    return this.getPrompt(copyId);
  }

  savePrompt({ id, projectId, title, content }) {
    const current = this.getPrompt(id);
    if (!current || current.projectId !== projectId) return null;
    if (current.title === title && current.content === content) return current;
    const now = new Date().toISOString();
    this.db.prepare("UPDATE prompts SET title = ?, content = ?, updated_at = ? WHERE id = ? AND project_id = ?").run(title, content, now, id, projectId);
    this.touchProject(projectId, now);
    return this.getPrompt(id);
  }

  deletePrompt(id, projectId) {
    const result = this.db.prepare("DELETE FROM prompts WHERE id = ? AND project_id = ?").run(id, projectId);
    if (Number(result.changes) > 0) this.touchProject(projectId);
    return true;
  }

  reorderPrompts(projectId, ids) {
    const update = this.db.prepare("UPDATE prompts SET position = ? WHERE id = ? AND project_id = ?");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      ids.forEach((id, position) => update.run(position, id, projectId));
      if (ids.length) this.touchProject(projectId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listPrompts(projectId);
  }

  listSituations(projectId) {
    return this.db.prepare("SELECT s.id, s.project_id AS projectId, s.title, s.folder_id AS folderId, f.name AS folderName, s.position, s.created_at AS createdAt, s.updated_at AS updatedAt FROM situations s LEFT JOIN project_entry_folders f ON f.id = s.folder_id AND f.project_id = s.project_id AND f.type = 'situation' WHERE s.project_id = ? ORDER BY s.position ASC, s.created_at ASC").all(projectId).map((entry) => ({ ...entry, folderId: entry.folderId || "", folderName: entry.folderName || "", position: Number(entry.position) }));
  }

  getSituation(id) {
    const entry = this.db.prepare("SELECT s.id, s.project_id AS projectId, s.title, s.content, s.folder_id AS folderId, f.name AS folderName, s.position, s.created_at AS createdAt, s.updated_at AS updatedAt FROM situations s LEFT JOIN project_entry_folders f ON f.id = s.folder_id AND f.project_id = s.project_id AND f.type = 'situation' WHERE s.id = ?").get(id);
    return entry ? { ...entry, folderId: entry.folderId || "", folderName: entry.folderName || "", position: Number(entry.position) } : null;
  }

  createSituation(projectId) {
    const titles = this.db.prepare("SELECT title FROM situations WHERE project_id = ?").all(projectId).map((entry) => entry.title);
    const numbers = titles.map((title) => /^새 시작 상황 (\d+)$/.exec(title)?.[1]).filter(Boolean).map(Number);
    const title = `새 시작 상황 ${Math.max(0, ...numbers) + 1}`;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM situations WHERE project_id = ?").get(projectId).position);
    this.db.prepare("INSERT INTO situations (id, project_id, title, content, position, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?)").run(id, projectId, title, position, now, now);
    this.touchProject(projectId, now);
    return this.getSituation(id);
  }

  duplicateSituation(id, projectId) {
    const source = this.getSituation(id);
    if (!source || source.projectId !== projectId) return null;
    const titles = this.db.prepare("SELECT title FROM situations WHERE project_id = ?").all(projectId).map((entry) => entry.title);
    const baseTitle = `${source.title} 사본`;
    let title = baseTitle;
    let number = 2;
    while (titles.includes(title)) title = `${baseTitle} ${number++}`;
    const copyId = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM situations WHERE project_id = ?").get(projectId).position);
    this.db.prepare("INSERT INTO situations (id, project_id, title, content, folder_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(copyId, projectId, title, source.content, source.folderId || "", position, now, now);
    this.touchProject(projectId, now);
    return this.getSituation(copyId);
  }

  saveSituation({ id, projectId, title, content }) {
    const current = this.getSituation(id);
    if (!current || current.projectId !== projectId) return null;
    if (current.title === title && current.content === content) return current;
    const now = new Date().toISOString();
    this.db.prepare("UPDATE situations SET title = ?, content = ?, updated_at = ? WHERE id = ? AND project_id = ?").run(title, content, now, id, projectId);
    this.touchProject(projectId, now);
    return this.getSituation(id);
  }

  deleteSituation(id, projectId) {
    const result = this.db.prepare("DELETE FROM situations WHERE id = ? AND project_id = ?").run(id, projectId);
    if (Number(result.changes) > 0) this.touchProject(projectId);
    return true;
  }

  reorderSituations(projectId, ids) {
    const update = this.db.prepare("UPDATE situations SET position = ? WHERE id = ? AND project_id = ?");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      ids.forEach((id, position) => update.run(position, id, projectId));
      if (ids.length) this.touchProject(projectId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listSituations(projectId);
  }

  listTemplates(type) {
    return this.db.prepare("SELECT t.id, t.type, t.title, t.folder_id AS folderId, f.name AS folderName, t.keywords, t.content, t.position, t.created_at AS createdAt, t.updated_at AS updatedAt FROM templates t LEFT JOIN template_folders f ON f.id = t.folder_id WHERE t.type = ? ORDER BY t.position ASC, t.created_at ASC").all(type).map((entry) => ({ ...entry, folderId: entry.folderId || "", folderName: entry.folderName || "", projectId: "global-templates", position: Number(entry.position), keywords: parseLorebookKeywords(entry.keywords) }));
  }

  getGlobalBackupData() {
    const templateTypes = ["prompt", "situation", "lorebook"];
    const templates = templateTypes.flatMap((type) => this.listTemplates(type).map((entry) => ({
      id: entry.id,
      type: entry.type,
      title: entry.title,
      folderId: entry.folderId,
      keywords: entry.keywords,
      content: entry.content,
      position: entry.position
    })));
    const templateFolders = templateTypes.flatMap((type) => this.listTemplateFolders(type).map((folder) => ({
      id: folder.id,
      type: folder.type,
      name: folder.name,
      position: folder.position
    })));
    return { templates, templateFolders };
  }

  appendGlobalBackupData(data) {
    const now = new Date().toISOString();
    const folderIds = new Map();
    const folderPositions = new Map(["prompt", "situation", "lorebook"].map((type) => [type, Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM template_folders WHERE type = ?").get(type).position) + 1]));
    const templatePositions = new Map(["prompt", "situation", "lorebook"].map((type) => [type, Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM templates WHERE type = ?").get(type).position) + 1]));
    const insertFolder = this.db.prepare("INSERT INTO template_folders (id, type, name, position, created_at) VALUES (?, ?, ?, ?, ?)");
    const insertTemplate = this.db.prepare("INSERT INTO templates (id, type, title, group_name, folder_id, keywords, content, position, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?)");

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const folder of data.templateFolders) {
        const id = crypto.randomUUID();
        folderIds.set(`${folder.type}:${folder.id}`, id);
        insertFolder.run(id, folder.type, folder.name, folderPositions.get(folder.type), now);
        folderPositions.set(folder.type, folderPositions.get(folder.type) + 1);
      }
      for (const entry of data.templates) {
        const folderId = entry.folderId ? folderIds.get(`${entry.type}:${entry.folderId}`) || "" : "";
        insertTemplate.run(crypto.randomUUID(), entry.type, entry.title, folderId, JSON.stringify(entry.keywords), entry.content, templatePositions.get(entry.type), now, now);
        templatePositions.set(entry.type, templatePositions.get(entry.type) + 1);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return {
      templates: data.templates.length,
      templateFolders: data.templateFolders.length
    };
  }

  getTemplate(id, type) {
    const entry = this.db.prepare("SELECT t.id, t.type, t.title, t.folder_id AS folderId, f.name AS folderName, t.keywords, t.content, t.position, t.created_at AS createdAt, t.updated_at AS updatedAt FROM templates t LEFT JOIN template_folders f ON f.id = t.folder_id WHERE t.id = ? AND t.type = ?").get(id, type);
    return entry ? { ...entry, folderId: entry.folderId || "", folderName: entry.folderName || "", projectId: "global-templates", position: Number(entry.position), keywords: parseLorebookKeywords(entry.keywords) } : null;
  }

  createTemplate(type) {
    const label = type === "lorebook" ? "로어북" : type === "situation" ? "시작 상황" : "프롬프트";
    const titles = this.db.prepare("SELECT title FROM templates WHERE type = ?").all(type).map((entry) => entry.title);
    const expression = new RegExp(`^새 ${label} (\\d+)$`);
    const numbers = titles.map((title) => expression.exec(title)?.[1]).filter(Boolean).map(Number);
    const nextNumber = Math.max(0, ...numbers) + 1;
    const title = `새 ${label} ${type === "prompt" ? String(nextNumber).padStart(2, "0") : nextNumber}`;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM templates WHERE type = ?").get(type).position);
    this.db.prepare("INSERT INTO templates (id, type, title, group_name, folder_id, keywords, content, position, created_at, updated_at) VALUES (?, ?, ?, '', '', '', '', ?, ?, ?)").run(id, type, title, position, now, now);
    return this.getTemplate(id, type);
  }

  duplicateTemplate(id, type) {
    const source = this.getTemplate(id, type);
    if (!source) return null;
    const titles = this.db.prepare("SELECT title FROM templates WHERE type = ?").all(type).map((entry) => entry.title);
    const baseTitle = `${source.title} 사본`;
    let title = baseTitle;
    let number = 2;
    while (titles.includes(title)) title = `${baseTitle} ${number++}`;
    const copyId = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM templates WHERE type = ?").get(type).position);
    this.db.prepare("INSERT INTO templates (id, type, title, group_name, folder_id, keywords, content, position, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?)").run(copyId, type, title, source.folderId || "", JSON.stringify(source.keywords), source.content, position, now, now);
    return this.getTemplate(copyId, type);
  }

  saveTemplate({ id, type, title, folderId = "", keywords = [], content }) {
    const now = new Date().toISOString();
    const validFolderId = folderId && this.db.prepare("SELECT id FROM template_folders WHERE id = ? AND type = ?").get(folderId, type) ? folderId : "";
    this.db.prepare("UPDATE templates SET title = ?, folder_id = ?, keywords = ?, content = ?, updated_at = ? WHERE id = ? AND type = ?").run(title, validFolderId, JSON.stringify(keywords), content, now, id, type);
    return this.getTemplate(id, type);
  }

  deleteTemplate(id, type) {
    this.db.prepare("DELETE FROM templates WHERE id = ? AND type = ?").run(id, type);
    return true;
  }

  reorderTemplates(type, ids) {
    const update = this.db.prepare("UPDATE templates SET position = ? WHERE id = ? AND type = ?");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      ids.forEach((id, position) => update.run(position, id, type));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listTemplates(type);
  }

  listTemplateFolders(type) {
    return this.db.prepare("SELECT id, type, name, position, created_at AS createdAt FROM template_folders WHERE type = ? ORDER BY position ASC, created_at ASC").all(type).map((folder) => ({ ...folder, position: Number(folder.position) }));
  }

  createTemplateFolder(type, name) {
    const id = crypto.randomUUID();
    const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM template_folders WHERE type = ?").get(type).position);
    this.db.prepare("INSERT INTO template_folders (id, type, name, position, created_at) VALUES (?, ?, ?, ?, ?)").run(id, type, name, position, new Date().toISOString());
    return this.listTemplateFolders(type).find((folder) => folder.id === id);
  }

  renameTemplateFolder(id, type, name) {
    this.db.prepare("UPDATE template_folders SET name = ? WHERE id = ? AND type = ?").run(name, id, type);
    return this.listTemplateFolders(type).find((folder) => folder.id === id) || null;
  }

  deleteTemplateFolder(id, type) {
    this.db.prepare("UPDATE templates SET folder_id = '' WHERE folder_id = ? AND type = ?").run(id, type);
    this.db.prepare("DELETE FROM template_folders WHERE id = ? AND type = ?").run(id, type);
    return true;
  }

  moveTemplateToFolder(id, type, folderId) {
    if (folderId && !this.db.prepare("SELECT id FROM template_folders WHERE id = ? AND type = ?").get(folderId, type)) throw new Error("폴더를 찾을 수 없습니다.");
    this.db.prepare("UPDATE templates SET folder_id = ? WHERE id = ? AND type = ?").run(folderId, id, type);
    return this.getTemplate(id, type);
  }

  listProjectEntryFolders(projectId, type) {
    return this.db.prepare("SELECT id, project_id AS projectId, type, name, position, created_at AS createdAt FROM project_entry_folders WHERE project_id = ? AND type = ? ORDER BY position ASC, created_at ASC").all(projectId, type).map((folder) => ({ ...folder, position: Number(folder.position) }));
  }

  createProjectEntryFolder(projectId, type, name) {
    const id = crypto.randomUUID();
    const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM project_entry_folders WHERE project_id = ? AND type = ?").get(projectId, type).position);
    this.db.prepare("INSERT INTO project_entry_folders (id, project_id, type, name, position, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, projectId, type, name, position, new Date().toISOString());
    this.touchProject(projectId);
    return this.listProjectEntryFolders(projectId, type).find((folder) => folder.id === id);
  }

  renameProjectEntryFolder(id, projectId, type, name) {
    const current = this.listProjectEntryFolders(projectId, type).find((folder) => folder.id === id);
    if (!current) return null;
    if (current.name !== name) {
      this.db.prepare("UPDATE project_entry_folders SET name = ? WHERE id = ? AND project_id = ? AND type = ?").run(name, id, projectId, type);
      this.touchProject(projectId);
    }
    return this.listProjectEntryFolders(projectId, type).find((folder) => folder.id === id) || null;
  }

  deleteProjectEntryFolder(id, projectId, type) {
    const table = { prompt: "prompts", situation: "situations", lorebook: "lorebooks" }[type];
    if (!table) throw new Error("폴더 종류가 올바르지 않습니다.");
    this.db.prepare(`UPDATE ${table} SET folder_id = '' WHERE folder_id = ? AND project_id = ?`).run(id, projectId);
    const result = this.db.prepare("DELETE FROM project_entry_folders WHERE id = ? AND project_id = ? AND type = ?").run(id, projectId, type);
    if (Number(result.changes) > 0) this.touchProject(projectId);
    return true;
  }

  moveProjectEntryToFolder(id, projectId, type, folderId) {
    const table = { prompt: "prompts", situation: "situations", lorebook: "lorebooks" }[type];
    const getter = { prompt: () => this.getPrompt(id), situation: () => this.getSituation(id), lorebook: () => this.getLorebook(id) }[type];
    if (!table || !getter) throw new Error("폴더 종류가 올바르지 않습니다.");
    if (folderId && !this.db.prepare("SELECT id FROM project_entry_folders WHERE id = ? AND project_id = ? AND type = ?").get(folderId, projectId, type)) throw new Error("폴더를 찾을 수 없습니다.");
    const current = getter();
    if (!current || current.projectId !== projectId) return null;
    if (current.folderId !== folderId) {
      this.db.prepare(`UPDATE ${table} SET folder_id = ? WHERE id = ? AND project_id = ?`).run(folderId, id, projectId);
      this.touchProject(projectId);
    }
    return getter();
  }

  listLorebooks(projectId) {
    return this.db.prepare("SELECT l.id, l.project_id AS projectId, l.title, l.folder_id AS folderId, f.name AS folderName, l.keywords, l.content, l.position, l.created_at AS createdAt, l.updated_at AS updatedAt FROM lorebooks l LEFT JOIN project_entry_folders f ON f.id = l.folder_id AND f.project_id = l.project_id AND f.type = 'lorebook' WHERE l.project_id = ? ORDER BY l.position ASC, l.created_at ASC").all(projectId).map((entry) => ({ ...entry, folderId: entry.folderId || "", folderName: entry.folderName || "", position: Number(entry.position), keywords: parseLorebookKeywords(entry.keywords) }));
  }

  getWork(projectId) {
    const row = this.db.prepare("SELECT introduction, character_preference AS characterPreference, age_rating AS ageRating, tags, updated_at AS updatedAt FROM works WHERE project_id = ?").get(projectId);
    let tags = [];
    try { tags = JSON.parse(row?.tags || "[]"); } catch {}
    return { projectId, introduction: row?.introduction || "", characterPreference: row?.characterPreference || "ALL", ageRating: row?.ageRating || "SAFE", tags: Array.isArray(tags) ? tags : [], updatedAt: row?.updatedAt || "" };
  }

  saveWork(projectId, introduction, tags, characterPreference = "ALL", ageRating = "SAFE") {
    const current = this.getWork(projectId);
    if (current.updatedAt && current.introduction === introduction && current.characterPreference === characterPreference && current.ageRating === ageRating && JSON.stringify(current.tags) === JSON.stringify(tags)) return current;
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO works (project_id, introduction, character_preference, age_rating, tags, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET introduction = excluded.introduction, character_preference = excluded.character_preference, age_rating = excluded.age_rating, tags = excluded.tags, updated_at = excluded.updated_at`).run(projectId, introduction, characterPreference, ageRating, JSON.stringify(tags), now);
    this.touchProject(projectId, now);
    return this.getWork(projectId);
  }

  listWorkTitleImages(projectId) {
    return this.db.prepare("SELECT id, project_id AS projectId, source_name AS sourceName, saved_path AS savedPath, position, created_at AS createdAt FROM work_title_images WHERE project_id = ? ORDER BY position ASC, created_at ASC").all(projectId);
  }

  createWorkTitleSlot(projectId) {
    const id = crypto.randomUUID();
    const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM work_title_images WHERE project_id = ?").get(projectId).position);
    this.db.prepare("INSERT INTO work_title_images (id, project_id, source_name, saved_path, position, created_at) VALUES (?, ?, '', '', ?, ?)").run(id, projectId, position, new Date().toISOString());
    this.touchProject(projectId);
    return this.listWorkTitleImages(projectId).find((image) => image.id === id);
  }

  addWorkTitleImage(projectId, sourceName, savedPath) {
    const id = crypto.randomUUID();
    const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM work_title_images WHERE project_id = ?").get(projectId).position);
    this.db.prepare("INSERT INTO work_title_images (id, project_id, source_name, saved_path, position, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, projectId, sourceName, savedPath, position, new Date().toISOString());
    this.touchProject(projectId);
    return this.listWorkTitleImages(projectId).find((image) => image.id === id);
  }

  updateWorkTitleImage(id, sourceName, savedPath) {
    const current = this.db.prepare("SELECT project_id AS projectId, source_name AS sourceName, saved_path AS savedPath FROM work_title_images WHERE id = ?").get(id);
    if (!current) return false;
    if (current.sourceName === sourceName && current.savedPath === savedPath) return true;
    this.db.prepare("UPDATE work_title_images SET source_name = ?, saved_path = ? WHERE id = ?").run(sourceName, savedPath, id);
    this.touchProject(current.projectId);
    return true;
  }

  setWorkTitleSlotImage(id, projectId, sourceName, savedPath) {
    const result = this.db.prepare("UPDATE work_title_images SET source_name = ?, saved_path = ?, created_at = ? WHERE id = ? AND project_id = ?").run(sourceName, savedPath, new Date().toISOString(), id, projectId);
    if (Number(result.changes) > 0) this.touchProject(projectId);
    return Number(result.changes) > 0;
  }

  clearWorkTitleSlotImage(id, projectId) {
    const result = this.db.prepare("UPDATE work_title_images SET source_name = '', saved_path = '' WHERE id = ? AND project_id = ?").run(id, projectId);
    if (Number(result.changes) > 0) this.touchProject(projectId);
    return Number(result.changes) > 0;
  }

  removeWorkTitleImage(id, projectId) { const result = this.db.prepare("DELETE FROM work_title_images WHERE id = ? AND project_id = ?").run(id, projectId); if (Number(result.changes) > 0) this.touchProject(projectId); return true; }

  getLorebook(id) {
    const entry = this.db.prepare("SELECT l.id, l.project_id AS projectId, l.title, l.folder_id AS folderId, f.name AS folderName, l.keywords, l.content, l.position, l.created_at AS createdAt, l.updated_at AS updatedAt FROM lorebooks l LEFT JOIN project_entry_folders f ON f.id = l.folder_id AND f.project_id = l.project_id AND f.type = 'lorebook' WHERE l.id = ?").get(id);
    return entry ? { ...entry, folderId: entry.folderId || "", folderName: entry.folderName || "", position: Number(entry.position), keywords: parseLorebookKeywords(entry.keywords) } : null;
  }

  createLorebook(projectId) {
    const titles = this.db.prepare("SELECT title FROM lorebooks WHERE project_id = ?").all(projectId).map((entry) => entry.title);
    const numbers = titles.map((title) => /^새 로어북 (\d+)$/.exec(title)?.[1]).filter(Boolean).map(Number);
    const title = `새 로어북 ${Math.max(0, ...numbers) + 1}`;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM lorebooks WHERE project_id = ?").get(projectId).position);
    this.db.prepare("INSERT INTO lorebooks (id, project_id, title, keywords, content, position, created_at, updated_at) VALUES (?, ?, ?, '', '', ?, ?, ?)").run(id, projectId, title, position, now, now);
    this.touchProject(projectId, now);
    return this.getLorebook(id);
  }

  duplicateLorebook(id, projectId) {
    const source = this.getLorebook(id);
    if (!source || source.projectId !== projectId) return null;
    const titles = this.db.prepare("SELECT title FROM lorebooks WHERE project_id = ?").all(projectId).map((entry) => entry.title);
    const baseTitle = `${source.title} 사본`;
    let title = baseTitle;
    let number = 2;
    while (titles.includes(title)) title = `${baseTitle} ${number++}`;
    const copyId = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM lorebooks WHERE project_id = ?").get(projectId).position);
    this.db.prepare("INSERT INTO lorebooks (id, project_id, title, keywords, content, folder_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(copyId, projectId, title, JSON.stringify(source.keywords), source.content, source.folderId || "", position, now, now);
    this.touchProject(projectId, now);
    return this.getLorebook(copyId);
  }

  saveLorebook({ id, projectId, title, keywords, content }) {
    const current = this.getLorebook(id);
    if (!current || current.projectId !== projectId) return null;
    if (current.title === title && current.content === content && JSON.stringify(current.keywords) === JSON.stringify(keywords)) return current;
    const now = new Date().toISOString();
    this.db.prepare("UPDATE lorebooks SET title = ?, keywords = ?, content = ?, updated_at = ? WHERE id = ? AND project_id = ?").run(title, JSON.stringify(keywords), content, now, id, projectId);
    this.touchProject(projectId, now);
    return this.getLorebook(id);
  }

  deleteLorebook(id, projectId) {
    const result = this.db.prepare("DELETE FROM lorebooks WHERE id = ? AND project_id = ?").run(id, projectId);
    if (Number(result.changes) > 0) this.touchProject(projectId);
    return true;
  }

  reorderLorebooks(projectId, ids) {
    const update = this.db.prepare("UPDATE lorebooks SET position = ? WHERE id = ? AND project_id = ?");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      ids.forEach((id, position) => update.run(position, id, projectId));
      if (ids.length) this.touchProject(projectId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listLorebooks(projectId);
  }

  addAsset({ projectId, sourceName, relativePath, savedPath, fileSize = 0, modifiedAt = 0, duplicateCount = 0 }) {
    const now = new Date().toISOString();
    const sameLogicalAssets = this.listAssets(projectId).filter((asset) => logicalKey(asset.relativePath) === logicalKey(relativePath));
    const id = sameLogicalAssets[0]?.id || crypto.randomUUID();
    if (sameLogicalAssets.length) {
      this.db.prepare("UPDATE assets SET source_name = ?, relative_path = ?, saved_path = ?, file_size = ?, modified_at = ?, duplicate_count = ?, created_at = ? WHERE id = ?")
        .run(sourceName, relativePath, savedPath, fileSize, modifiedAt, duplicateCount, now, id);
      const remove = this.db.prepare("DELETE FROM assets WHERE id = ?");
      sameLogicalAssets.slice(1).forEach((asset) => remove.run(asset.id));
    } else {
      this.db.prepare("INSERT INTO assets (id, project_id, source_name, relative_path, saved_path, created_at, file_size, modified_at, duplicate_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, projectId, sourceName, relativePath, savedPath, now, fileSize, modifiedAt, duplicateCount);
    }
    this.touchProject(projectId, now);
    return { id, projectId, sourceName, relativePath, savedPath, createdAt: now, fileSize, modifiedAt, duplicateCount };
  }

  listAssets(projectId) {
    return this.db.prepare(`
      SELECT id, project_id AS projectId, source_name AS sourceName,
             relative_path AS relativePath, saved_path AS savedPath, created_at AS createdAt,
             file_size AS fileSize, modified_at AS modifiedAt, duplicate_count AS duplicateCount,
             review_status AS reviewStatus, cleaned_path AS cleanedPath
      FROM assets WHERE project_id = ? ORDER BY created_at DESC
    `).all(projectId).map((asset) => ({ ...asset, fileSize: Number(asset.fileSize), modifiedAt: Number(asset.modifiedAt), duplicateCount: Number(asset.duplicateCount) }));
  }

  getAsset(id) {
    const asset = this.db.prepare(`
      SELECT id, project_id AS projectId, source_name AS sourceName,
             relative_path AS relativePath, saved_path AS savedPath, created_at AS createdAt,
             file_size AS fileSize, modified_at AS modifiedAt, duplicate_count AS duplicateCount,
             review_status AS reviewStatus, cleaned_path AS cleanedPath
      FROM assets WHERE id = ?
    `).get(id);
    return asset ? { ...asset, fileSize: Number(asset.fileSize), modifiedAt: Number(asset.modifiedAt), duplicateCount: Number(asset.duplicateCount) } : null;
  }

  replaceProjectInventory(projectId, entries) {
    const previous = new Map<string, any>(this.listAssets(projectId).map((asset) => [logicalKey(asset.relativePath), asset]));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM assets WHERE project_id = ?").run(projectId);
      const insert = this.db.prepare("INSERT INTO assets (id, project_id, source_name, relative_path, saved_path, created_at, file_size, modified_at, duplicate_count, review_status, cleaned_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const now = new Date().toISOString();
      entries.forEach((entry) => { const old = previous.get(logicalKey(entry.relativePath)); insert.run(old?.id || crypto.randomUUID(), projectId, entry.sourceName, entry.relativePath, entry.savedPath, now, entry.fileSize, entry.modifiedAt, entry.duplicateCount, old?.reviewStatus || "unreviewed", old?.cleanedPath || ""); });
      this.touchProject(projectId, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listAssets(projectId);
  }

  refreshTrackedMetadata(projectId, metadata) {
    let changed = false;
    const retainedIds = new Set(metadata.map((item) => item.id));
    this.listAssets(projectId).filter((asset) => !retainedIds.has(asset.id)).forEach((asset) => {
      this.db.prepare("DELETE FROM assets WHERE id = ?").run(asset.id);
      changed = true;
    });
    const update = this.db.prepare("UPDATE assets SET file_size = ?, modified_at = ? WHERE id = ?");
    metadata.forEach((item) => {
      const current = this.getAsset(item.id);
      if (!current || current.fileSize === item.fileSize && current.modifiedAt === item.modifiedAt) return;
      update.run(item.fileSize, item.modifiedAt, item.id);
      changed = true;
    });
    if (changed) this.touchProject(projectId);
    return this.listAssets(projectId);
  }

  removeAsset(id) {
    const asset = this.getAsset(id);
    const result = this.db.prepare("DELETE FROM assets WHERE id = ?").run(id);
    if (asset && Number(result.changes) > 0) this.touchProject(asset.projectId);
    return true;
  }

  setAssetReview(id, status, cleanedPath) {
    if (!["unreviewed", "auto", "manual", "failed"].includes(status)) throw new Error("검열 상태가 올바르지 않습니다.");
    const asset = this.getAsset(id);
    if (!asset) return false;
    if (asset.reviewStatus === status && (cleanedPath === undefined || asset.cleanedPath === cleanedPath)) return true;
    if (cleanedPath === undefined) this.db.prepare("UPDATE assets SET review_status = ? WHERE id = ?").run(status, id);
    else this.db.prepare("UPDATE assets SET review_status = ?, cleaned_path = ? WHERE id = ?").run(status, cleanedPath, id);
    this.touchProject(asset.projectId);
    return true;
  }

  getAssetPath(id) {
    return this.db.prepare("SELECT saved_path AS savedPath FROM assets WHERE id = ?").get(id)?.savedPath || this.db.prepare("SELECT saved_path AS savedPath FROM work_title_images WHERE id = ?").get(id)?.savedPath || null;
  }

  close() {
    this.db.close();
  }
}

module.exports = { Store };
