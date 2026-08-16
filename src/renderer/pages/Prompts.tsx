import { useEffect, useRef, useState } from "react";
import { ClipboardCopy, Copy, Eye, GripVertical, LibraryBig, Plus, Save, Table2, Trash2, X } from "lucide-react";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { MarkdownPreviewModal } from "../components/MarkdownPreview";
import { TemplatePicker } from "../components/TemplatePicker";
import { EntryFolders } from "../components/LorebookTemplateFolders";
import { DeleteConfirmModal } from "../components/Shell";

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markMatches(markup, selectedText) {
  if (!selectedText || selectedText.length > 100) return markup;
  const expression = new RegExp(escapeRegularExpression(escapeHtml(selectedText)), "g");
  return markup.split(/(<[^>]+>)/g).map((part) => part.startsWith("<") ? part : part.replace(expression, '<mark class="prompt-match">$&</mark>')).join("");
}

function highlightLine(line, selectedText) {
  let markup = escapeHtml(line);
  markup = markup.replace(/^(\s*)(#{1,6}\s+.*)$/, '$1<span class="md-heading">$2</span>');
  markup = markup.replace(/^(\s*)(&gt;)(\s?)/, '$1<span class="md-quote">$2</span>$3');
  markup = markup.replace(/^(\s*)([-*+]|\d+\.)(\s)/, '$1<span class="md-list">$2</span>$3');
  markup = markup.replace(/^(\s*)(```|~~~)/, '$1<span class="md-fence">$2</span>');
  return markMatches(markup, selectedText);
}

function splitTableRow(line) {
  const source = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cell = "";
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "|" && source[index - 1] !== "\\") { cells.push(cell.trim()); cell = ""; }
    else if (source[index] === "|" && source[index - 1] === "\\") cell = `${cell.slice(0, -1)}|`;
    else cell += source[index];
  }
  cells.push(cell.trim());
  return cells;
}

function findMarkdownTable(content, position) {
  const lines = content.split("\n");
  const offsets = [];
  let offset = 0;
  lines.forEach((line) => { offsets.push(offset); offset += line.length + 1; });
  const lineIndex = Math.max(0, offsets.findLastIndex((lineOffset) => lineOffset <= position));
  const isTableLine = (line) => /^\s*\|.*\|\s*$/.test(line);
  if (!isTableLine(lines[lineIndex])) return null;
  let first = lineIndex;
  let last = lineIndex;
  while (first > 0 && isTableLine(lines[first - 1])) first -= 1;
  while (last < lines.length - 1 && isTableLine(lines[last + 1])) last += 1;
  const block = lines.slice(first, last + 1);
  const dividerIndex = block.findIndex((line) => splitTableRow(line).every((cell) => /^:?-+:?$/.test(cell)));
  if (dividerIndex !== 1) return null;
  const headers = splitTableRow(block[0]);
  const rows = block.slice(2).map(splitTableRow).map((row) => Array.from({ length: headers.length }, (_, index) => row[index] || ""));
  return { start: offsets[first], end: offsets[last] + lines[last].length, headers, rows: rows.length ? rows : [Array(headers.length).fill("")] };
}

function MarkdownTableDialog({ initialTable, onClose, onInsert }) {
  const [columns, setColumns] = useState(initialTable?.headers.length || 3);
  const [rows, setRows] = useState(initialTable?.rows.length || 3);
  const [headers, setHeaders] = useState(initialTable?.headers || ["열 1", "열 2", "열 3"]);
  const [body, setBody] = useState(initialTable?.rows || Array.from({ length: 3 }, () => ["", "", ""]));

  function resize(nextColumns, nextRows) {
    setHeaders((current) => Array.from({ length: nextColumns }, (_, index) => current[index] ?? `열 ${index + 1}`));
    setBody((current) => Array.from({ length: nextRows }, (_, rowIndex) => Array.from({ length: nextColumns }, (_, columnIndex) => current[rowIndex]?.[columnIndex] ?? "")));
  }

  function changeColumns(value) {
    const next = Math.max(1, Math.min(99, Number(value) || 1));
    setColumns(next); resize(next, rows);
  }

  function changeRows(value) {
    const next = Math.max(1, Math.min(99, Number(value) || 1));
    setRows(next); resize(columns, next);
  }

  function updateHeader(index, value) {
    setHeaders((current) => current.map((cell, cellIndex) => cellIndex === index ? value : cell));
  }

  function updateCell(rowIndex, columnIndex, value) {
    setBody((current) => current.map((row, currentRow) => currentRow === rowIndex ? row.map((cell, currentColumn) => currentColumn === columnIndex ? value : cell) : row));
  }

  function submit(event) {
    event.preventDefault();
    onInsert(headers, body);
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="modal markdown-table-modal" onSubmit={submit} onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLElement).classList.contains("markdown-table-cell-input") && event.preventDefault()}>
      <div className="modal-heading"><h2>마크다운 표 {initialTable ? "편집" : "삽입"}</h2><button type="button" className="modal-close" aria-label="닫기" onClick={onClose}>×</button></div>
      <div className="markdown-table-options">
        <label>열 수<input type="number" min="1" max="99" value={columns} onChange={(event) => changeColumns(event.target.value)} /></label>
        <label>데이터 행 수<input type="number" min="1" max="99" value={rows} onChange={(event) => changeRows(event.target.value)} /></label>
      </div>
      <div className="markdown-table-preview" style={{ gridTemplateColumns: `repeat(${columns}, minmax(90px, 1fr))` }}>
        {headers.map((cell, index) => <input autoFocus={index === 0} className="markdown-table-cell-input header" aria-label={`제목 ${index + 1}`} key={`header-${index}`} value={cell} onChange={(event) => updateHeader(index, event.target.value)} />)}
        {body.flatMap((row, rowIndex) => row.map((cell, columnIndex) => <input className="markdown-table-cell-input" aria-label={`${rowIndex + 1}행 ${columnIndex + 1}열`} key={`cell-${rowIndex}-${columnIndex}`} value={cell} onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)} />))}
      </div>
      <div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>취소</button><button className="primary-button">표 {initialTable ? "적용" : "삽입"}</button></div>
    </form>
  </div>;
}

function Prompts({ project, kind = "prompt", api = null }) {
  const isSituation = kind === "situation";
  const entryApi = api || (isSituation ? window.aaa.situations : window.aaa.prompts);
  const entryLabel = isSituation ? "시작 상황" : "프롬프트";
  const emptyMessage = isSituation ? "시작 상황이 없습니다." : "프롬프트가 없습니다.";
  const [prompts, setPrompts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState({ length: 0 });
  const [cursorWord, setCursorWord] = useState("");
  const [dropIndicator, setDropIndicator] = useState(null);
  const [tableDialog, setTableDialog] = useState(null);
  const [tableContextMenu, setTableContextMenu] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [createMode, setCreateMode] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [folders, setFolders] = useState([]);
  const titleInput = useRef(null);
  const editorInput = useRef(null);
  const codeView = useRef(null);
  const draftRef = useRef(null);
  const autoSaveTimer = useRef(null);
  const tableSelection = useRef({ start: 0, end: 0 });
  const markdownEditor = useRef(null);
  const draggedId = useRef(null);

  function setCurrentDraft(nextDraft) {
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }

  async function loadPrompts(preferredId = null) {
    const entries = await entryApi.list(project.id);
    setPrompts(entries);
    const nextId = preferredId || selectedId;
    if (!nextId || !entries.some((item) => item.id === nextId)) {
      setSelectedId(entries[0]?.id || null);
      setCurrentDraft(entries[0] ? await entryApi.get(entries[0].id) : null);
    }
  }

  useEffect(() => {
    setSelectedId(null); setCurrentDraft(null); setPreviewOpen(false); setLoading(true);
    Promise.all([loadPrompts(), entryApi.listFolders ? entryApi.listFolders(project.id) : Promise.resolve([])])
      .then(([, loadedFolders]) => setFolders(loadedFolders))
      .catch((reason) => setStatus(reason.message)).finally(() => setLoading(false));
  }, [project.id, kind]);

  useEffect(() => () => {
    clearTimeout(autoSaveTimer.current);
    const currentDraft = draftRef.current;
    if (currentDraft?.projectId === project.id) entryApi.save(currentDraft).catch(() => {});
  }, [project.id, kind]);

  async function saveDraft(prompt = draftRef.current, showStatus = false) {
    if (!prompt) return null;
    try {
      const saved = await entryApi.save(prompt);
      if (draftRef.current?.id === saved.id && draftRef.current.title === prompt.title && draftRef.current.content === prompt.content) setCurrentDraft(saved);
      setPrompts(await entryApi.list(project.id));
      if (showStatus) setStatus("저장됨");
      return saved;
    } catch (reason) {
      setStatus(reason.message);
      return null;
    }
  }

  function scheduleAutoSave() {
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const savingDraft = draftRef.current;
      const saved = await saveDraft(savingDraft);
      const currentDraft = draftRef.current;
      if (saved && currentDraft?.id === savingDraft?.id && currentDraft.title === savingDraft.title && currentDraft.content === savingDraft.content) setStatus("자동 저장됨");
    }, 700);
  }

  function updateDraft(changes) {
    const currentDraft = draftRef.current;
    if (!currentDraft) return;
    setCurrentDraft({ ...currentDraft, ...changes });
    setStatus("");
    scheduleAutoSave();
  }

  async function selectPrompt(id) {
    if (id === selectedId) return;
    try {
      clearTimeout(autoSaveTimer.current);
      await saveDraft();
      const prompt = await entryApi.get(id);
      setSelectedId(id); setCurrentDraft(prompt); setSelection({ length: 0 }); setCursorWord(""); setStatus("");
    } catch (reason) { setStatus(reason.message); }
  }

  async function createPrompt(templateOrFolder = null) {
    try {
      clearTimeout(autoSaveTimer.current);
      await saveDraft();
      let prompt = await entryApi.create(project.id);
      if (templateOrFolder && typeof templateOrFolder === "object") prompt = await entryApi.save({ ...prompt, title: templateOrFolder.title, content: templateOrFolder.content });
      const folderId = typeof templateOrFolder === "string" ? templateOrFolder : "";
      if (folderId && entryApi.moveToFolder) prompt = await entryApi.moveToFolder(project.id, prompt.id, folderId);
      setPrompts(await entryApi.list(project.id));
      setSelectedId(prompt.id); setCurrentDraft(prompt); setSelection({ length: 0 }); setCursorWord(""); setStatus("");
      setCreateMode(null);
      requestAnimationFrame(() => titleInput.current?.focus());
    } catch (reason) { setStatus(reason.message); }
  }

  async function createPromptsFromTemplates(selectedTemplates) {
    if (!selectedTemplates.length) return;
    setCreateMode(null);
    try {
      clearTimeout(autoSaveTimer.current);
      await saveDraft();
      let targetFolderId = "";
      const sourceFolderName = selectedTemplates[0]?.folderName?.trim();
      if (!api && sourceFolderName && sourceFolderName !== "미분류" && entryApi.createFolder) {
        const createdFolder = await entryApi.createFolder(project.id, sourceFolderName);
        targetFolderId = createdFolder.id;
        setFolders((current) => [...current, createdFolder]);
      }
      let lastCreated = null;
      for (const template of selectedTemplates) {
        let created = await entryApi.create(project.id);
        created = await entryApi.save({ ...created, title: template.title, content: template.content });
        if (targetFolderId) created = await entryApi.moveToFolder(project.id, created.id, targetFolderId);
        lastCreated = created;
      }
      const entries = await entryApi.list(project.id);
      setPrompts(entries);
      if (lastCreated) { setSelectedId(lastCreated.id); setCurrentDraft(await entryApi.get(lastCreated.id)); }
      setStatus("");
    } catch (reason) { setStatus(reason.message); }
  }

  async function createFolder(name) {
    const created = await entryApi.createFolder(project.id, name);
    setFolders((current) => [...current, created]);
  }

  async function renameFolder(id, name) {
    const renamed = await entryApi.renameFolder(project.id, id, name);
    setFolders((current) => current.map((folder) => folder.id === id ? renamed : folder));
    setPrompts((current) => current.map((entry) => entry.folderId === id ? { ...entry, folderName: renamed.name } : entry));
  }

  async function deleteFolder(id) {
    await entryApi.deleteFolder(project.id, id);
    setFolders((current) => current.filter((folder) => folder.id !== id));
    setPrompts((current) => current.map((entry) => entry.folderId === id ? { ...entry, folderId: "", folderName: "" } : entry));
    if (draftRef.current?.folderId === id) setCurrentDraft({ ...draftRef.current, folderId: "", folderName: "" });
  }

  async function moveToFolder(id, folderId) {
    if (!id) return;
    const moved = await entryApi.moveToFolder(project.id, id, folderId);
    setPrompts((current) => current.map((entry) => entry.id === id ? moved : entry));
    if (draftRef.current?.id === id) setCurrentDraft(moved);
  }

  async function reorderFolderEntry(sourceId, targetId, edge, folderId) {
    if (!sourceId || sourceId === targetId) return;
    try {
      let ordered = [...prompts].sort((left, right) => left.position - right.position);
      let source = ordered.find((entry) => entry.id === sourceId);
      if (!source) return;
      if (source.folderId !== folderId) {
        source = await entryApi.moveToFolder(project.id, sourceId, folderId);
        ordered = ordered.map((entry) => entry.id === sourceId ? source : entry);
      }
      ordered = ordered.filter((entry) => entry.id !== sourceId);
      const targetIndex = ordered.findIndex((entry) => entry.id === targetId);
      if (targetIndex < 0) return;
      ordered.splice(targetIndex + (edge === "after" ? 1 : 0), 0, source);
      const reordered = ordered.map((entry, position) => ({ ...entry, position }));
      setPrompts(reordered);
      setPrompts(await entryApi.reorder(project.id, reordered.map((entry) => entry.id)));
      setStatus("순서 저장됨");
    } catch (reason) { setStatus(reason.message); }
  }

  async function openTemplatePicker() {
    setCreateMode("templates");
    setTemplatesLoading(true);
    try { setTemplates(await (isSituation ? window.aaa.situationTemplates : window.aaa.promptTemplates).list("global-templates")); }
    catch (reason) { setStatus(reason.message); setTemplates([]); }
    finally { setTemplatesLoading(false); }
  }

  async function savePrompt() {
    if (!draftRef.current) return;
    clearTimeout(autoSaveTimer.current);
    setStatus("");
    await saveDraft(draftRef.current, true);
  }

  async function duplicatePrompt() {
    const currentDraft = draftRef.current;
    if (!currentDraft) return;
    try {
      clearTimeout(autoSaveTimer.current);
      await saveDraft();
      const copy = await entryApi.duplicate(currentDraft.id, project.id);
      setPrompts(await entryApi.list(project.id));
      setSelectedId(copy.id); setCurrentDraft(copy); setSelection({ length: 0 }); setCursorWord(""); setStatus("사본을 만들었습니다.");
      requestAnimationFrame(() => titleInput.current?.focus());
    } catch (reason) { setStatus(reason.message); }
  }

  async function copyContent() {
    try { await navigator.clipboard.writeText(draftRef.current?.content || ""); setStatus("복사됨"); }
    catch { setStatus("클립보드에 복사하지 못했습니다."); }
  }

  function updateSelection({ highlightWord = false } = {}) {
    const input = editorInput.current;
    if (!input) return;
    const { selectionStart: start, selectionEnd: end, value } = input;
    setSelection({ length: end - start });
    if (!highlightWord || start !== end) { setCursorWord(""); return; }
    const isWordCharacter = (character) => /[\p{L}\p{N}_-]/u.test(character);
    let left = start;
    let right = start;
    if (!isWordCharacter(value[right]) && isWordCharacter(value[left - 1])) left -= 1;
    if (!isWordCharacter(value[left])) { setCursorWord(""); return; }
    while (left > 0 && isWordCharacter(value[left - 1])) left -= 1;
    while (right < value.length && isWordCharacter(value[right])) right += 1;
    setCursorWord(value.slice(left, right));
  }

  function syncScroll() {
    const input = editorInput.current;
    if (codeView.current && input) codeView.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
  }

  function indentWithTab(event) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const input = event.currentTarget;
    const { selectionStart, selectionEnd, value } = input;
    const nextContent = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    updateDraft({ content: nextContent });
    requestAnimationFrame(() => input.setSelectionRange(selectionStart + 2, selectionStart + 2));
  }

  function openTableDialog() {
    const input = editorInput.current;
    const selection = input ? { start: input.selectionStart, end: input.selectionEnd } : { start: draftRef.current?.content.length || 0, end: draftRef.current?.content.length || 0 };
    tableSelection.current = selection;
    setTableDialog({});
  }

  function editTableFromContextMenu(event) {
    const existingTable = findMarkdownTable(draftRef.current?.content || "", event.currentTarget.selectionStart);
    if (!existingTable) return;
    event.preventDefault();
    setTableContextMenu({ x: Math.min(event.clientX, window.innerWidth - 150), y: Math.min(event.clientY, window.innerHeight - 54), table: existingTable });
  }

  function openTableEditorFromMenu() {
    if (!tableContextMenu) return;
    const existingTable = tableContextMenu.table;
    tableSelection.current = { start: existingTable.start, end: existingTable.end };
    setTableContextMenu(null);
    setTableDialog(existingTable);
  }

  function insertMarkdownTable(headers, rows) {
    const currentDraft = draftRef.current;
    if (!currentDraft) return;
    const { start, end } = tableSelection.current;
    const before = currentDraft.content.slice(0, start);
    const after = currentDraft.content.slice(end);
    const editing = Boolean(tableDialog?.headers);
    const leadingBreak = editing || !before ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trailingBreak = editing || !after ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const compactCell = (cell) => cell.trim().replaceAll("|", "\\|").replaceAll("\n", " ");
    const header = `|${headers.map(compactCell).join("|")}|`;
    const divider = `|${headers.map(() => "-").join("|")}|`;
    const body = rows.map((row) => `|${row.map(compactCell).join("|")}|`).join("\n");
    const table = `${header}\n${divider}\n${body}`;
    updateDraft({ content: `${before}${leadingBreak}${table}${trailingBreak}${after}` });
    setTableDialog(null);
    const firstHeaderStart = start + leadingBreak.length + 1;
    requestAnimationFrame(() => {
      editorInput.current?.focus();
      editorInput.current?.setSelectionRange(firstHeaderStart, firstHeaderStart + headers[0].trim().length);
      updateSelection();
    });
  }

  async function deletePrompt() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    clearTimeout(autoSaveTimer.current);
    try {
      await entryApi.delete(pendingDelete.id, project.id);
      const entries = await entryApi.list(project.id);
      setPrompts(entries);
      setSelectedId(entries[0]?.id || null);
      setCurrentDraft(entries[0] ? await entryApi.get(entries[0].id) : null);
      setPendingDelete(null);
      setStatus("");
    } catch (reason) { setStatus(reason.message); }
    finally { setDeleting(false); }
  }

  useEffect(() => {
    const listener = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && draft) { event.preventDefault(); savePrompt(); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [draft]);

  useEffect(() => {
    if (!tableContextMenu) return undefined;
    const closeMenu = () => setTableContextMenu(null);
    const closeWithEscape = (event) => event.key === "Escape" && closeMenu();
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeWithEscape);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeWithEscape);
      window.removeEventListener("blur", closeMenu);
    };
  }, [tableContextMenu]);

  async function movePrompt(targetId, edge = "before") {
    const sourceId = draggedId.current;
    draggedId.current = null;
    if (!sourceId || sourceId === targetId) return;
    const ordered = [...prompts];
    const sourceIndex = ordered.findIndex((entry) => entry.id === sourceId);
    if (sourceIndex < 0) return;
    const [source] = ordered.splice(sourceIndex, 1);
    const targetIndex = ordered.findIndex((entry) => entry.id === targetId);
    if (targetIndex < 0) return;
    ordered.splice(targetIndex + (edge === "after" ? 1 : 0), 0, source);
    const reordered = ordered.map((entry, position) => ({ ...entry, position }));
    setPrompts(reordered);
    try {
      setPrompts(await entryApi.reorder(project.id, reordered.map((entry) => entry.id)));
      setStatus("순서 저장됨");
    } catch (reason) {
      setStatus(reason.message);
      setPrompts(await entryApi.list(project.id));
    }
  }

  const lines = (draft?.content || "").split("\n");
  const sortedPrompts = [...prompts].sort((left, right) => left.position - right.position);
  return <><section className="prompt-workspace">
    {entryApi.listFolders ? <EntryFolders entryLabel={entryLabel} folders={folders} entries={sortedPrompts} selectedId={selectedId} onSelect={selectPrompt} onCreateEntry={createPrompt} onCreateFolder={createFolder} onRenameFolder={renameFolder} onDeleteFolder={deleteFolder} onMove={moveToFolder} onReorder={reorderFolderEntry} onOpenTemplates={!api ? openTemplatePicker : null} compactActions={!api} /> : <aside className="prompt-sidebar"><div className="prompt-sidebar-heading"><strong>{entryLabel}</strong><button className="outline-button button-with-icon" onClick={() => createPrompt()}><Plus size={16} />새 {entryLabel}</button>{!api && <button className="outline-button button-with-icon" onClick={openTemplatePicker}><LibraryBig size={16} />템플릿 {entryLabel} 추가</button>}</div><div className="prompt-list">{loading ? <p>불러오는 중…</p> : prompts.map((prompt) => <button key={prompt.id} draggable className={`lorebook-list-button ${prompt.id === selectedId ? "active" : ""} ${dropIndicator?.id === prompt.id ? `drop-${dropIndicator.edge}` : ""}`} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; draggedId.current = prompt.id; }} onDragEnd={() => { draggedId.current = null; setDropIndicator(null); }} onDragOver={(event) => { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); setDropIndicator({ id: prompt.id, edge: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" }); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropIndicator(null); }} onDrop={(event) => { event.preventDefault(); const edge = dropIndicator?.id === prompt.id ? dropIndicator.edge : "before"; setDropIndicator(null); movePrompt(prompt.id, edge); }} onClick={() => selectPrompt(prompt.id)}><span className="lorebook-list-drag"><GripVertical size={17} /></span><span className="lorebook-list-copy"><strong>{prompt.title}</strong></span></button>)}</div></aside>}
    <div className="prompt-editor">{draft ? <><header><input ref={titleInput} value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder={`${entryLabel} 제목`} /><div><span className={status.includes("저장") || status === "복사됨" ? "success" : "error"}>{status}</span><button className="outline-button editor-icon-button editor-table-action" aria-label="표 생성" data-tooltip="표 생성" onClick={() => markdownEditor.current?.openTableDialog()}><Table2 size={17} /></button><button className="outline-button editor-icon-button" aria-label="복사" data-tooltip="복사" onClick={copyContent}><ClipboardCopy size={17} /></button><button className="outline-button editor-icon-button" aria-label="사본 생성" data-tooltip="사본 생성" onClick={duplicatePrompt}><Copy size={17} /></button><button className="outline-button editor-icon-button" aria-label="삭제" data-tooltip="삭제" onClick={() => setPendingDelete(draft)}><Trash2 size={17} /></button><button className="primary-button editor-icon-button" aria-label="저장" data-tooltip="저장" onClick={savePrompt}><Save size={17} /></button></div></header><MarkdownEditor ref={markdownEditor} value={draft.content} onChange={(content) => updateDraft({ content })} bottomPanel={isSituation ? <div className="situation-preview-bar"><button className="outline-button button-with-icon" onClick={() => setPreviewOpen(true)}><Eye size={16} />미리보기</button></div> : null} /></> : <div className="prompt-empty"><p>{emptyMessage}</p></div>}</div>
  </section>{createMode === "templates" && <TemplatePicker grouped fixedHeight title={`템플릿 ${entryLabel} 선택`} templates={templates} loading={templatesLoading} onSelect={createPrompt} onSelectGroup={createPromptsFromTemplates} onClose={() => setCreateMode(null)} />}{previewOpen && draft && <MarkdownPreviewModal title={`${draft.title} 미리보기`} content={draft.content} basePath={project.savePath} onClose={() => setPreviewOpen(false)} />}{pendingDelete && <DeleteConfirmModal title={`${entryLabel} 삭제`} target={pendingDelete.title || `제목 없는 ${entryLabel}`} busy={deleting} onClose={() => setPendingDelete(null)} onConfirm={deletePrompt} />}</>;
}

export { Prompts, MarkdownTableDialog, findMarkdownTable, highlightLine };
