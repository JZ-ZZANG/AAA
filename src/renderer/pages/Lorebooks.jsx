import { useEffect, useRef, useState } from "react";
import { ClipboardCopy, Copy, GripVertical, LibraryBig, Plus, Save, Table2, Trash2, X } from "lucide-react";
import { MarkdownTableDialog, findMarkdownTable, highlightLine } from "./Prompts.jsx";
import { MarkdownEditor } from "../components/MarkdownEditor.jsx";
import { TemplatePicker } from "../components/TemplatePicker.jsx";
import { LorebookTemplateFolders } from "../components/LorebookTemplateFolders.jsx";
import { DeleteConfirmModal } from "../components/Shell.jsx";

function LorebookKeywords({ entry, onChange }) {
  const [keywordInput, setKeywordInput] = useState("");
  const disabled = !entry;
  const keywords = entry?.keywords || [];

  function addKeyword() {
    const keyword = keywordInput.trim().replaceAll(",", "");
    if (disabled || !keyword) return;
    if (!keywords.includes(keyword)) onChange({ keywords: [...keywords, keyword] });
    setKeywordInput("");
  }

  return <div className={`lorebook-keyword-editor ${disabled ? "disabled" : ""}`}>
    <strong>활성 키워드</strong>
    <div className="lorebook-keyword-add"><input disabled={disabled} value={keywordInput} onChange={(event) => setKeywordInput(event.target.value.replaceAll(",", ""))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addKeyword(); } }} placeholder="키워드 입력" /><button disabled={disabled} className="outline-button icon-button" aria-label="키워드 추가" title="키워드 추가" onClick={addKeyword}><Plus size={16} /></button></div>
    <div className="lorebook-keyword-list">{keywords.map((keyword) => <span className="lorebook-keyword" key={keyword}>{keyword}<button aria-label={`${keyword} 삭제`} onClick={() => onChange({ keywords: keywords.filter((item) => item !== keyword) })}><X size={13} /></button></span>)}</div>
  </div>;
}

function Lorebooks({ project, api = null }) {
  const entryApi = api || window.aaa.lorebooks;
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [selection, setSelection] = useState({ length: 0 });
  const [cursorWord, setCursorWord] = useState("");
  const [tableDialog, setTableDialog] = useState(null);
  const [tableContextMenu, setTableContextMenu] = useState(null);
  const [dropIndicator, setDropIndicator] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [folders, setFolders] = useState([]);
  const entriesRef = useRef([]);
  const saveTimers = useRef(new Map());
  const draggedId = useRef(null);
  const contentInput = useRef(null);
  const codeView = useRef(null);
  const tableSelection = useRef({ start: 0, end: 0 });
  const markdownEditor = useRef(null);

  function replaceEntries(nextEntries) {
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([entryApi.list(project.id), entryApi.listFolders ? entryApi.listFolders(project.id) : Promise.resolve([])]).then(([loaded, loadedFolders]) => {
      replaceEntries(loaded);
      setFolders(loadedFolders);
      setSelectedId((current) => loaded.some((entry) => entry.id === current) ? current : loaded[0]?.id || null);
    }).catch((reason) => setStatus(reason.message)).finally(() => setLoading(false));
    return () => {
      saveTimers.current.forEach(clearTimeout);
      saveTimers.current.clear();
      entriesRef.current.filter((entry) => entry.projectId === project.id).forEach((entry) => entryApi.save(entry).catch(() => {}));
    };
  }, [project.id]);

  function scheduleSave(entry) {
    clearTimeout(saveTimers.current.get(entry.id));
    saveTimers.current.set(entry.id, setTimeout(async () => {
      try { await entryApi.save(entry); setStatus("자동 저장됨"); }
      catch (reason) { setStatus(reason.message); }
      saveTimers.current.delete(entry.id);
    }, 700));
  }

  function updateEntry(id, changes) {
    const nextEntries = entriesRef.current.map((entry) => entry.id === id ? { ...entry, ...changes } : entry);
    replaceEntries(nextEntries);
    const changed = nextEntries.find((entry) => entry.id === id);
    if (changed) scheduleSave(changed);
    setStatus("");
  }

  async function saveEntry(entry) {
    if (!entry) return;
    clearTimeout(saveTimers.current.get(entry.id));
    saveTimers.current.delete(entry.id);
    try { await entryApi.save(entry); setStatus("저장됨"); }
    catch (reason) { setStatus(reason.message); }
  }

  async function createEntry(templateOrFolder = null) {
    if (templateOrFolder && typeof templateOrFolder === "object") return createEntriesFromTemplates([templateOrFolder]);
    const folderId = typeof templateOrFolder === "string" ? templateOrFolder : "";
    try {
      let created = await entryApi.create(project.id);
      if (folderId && entryApi.moveToFolder) created = await entryApi.moveToFolder(project.id, created.id, folderId);
      replaceEntries([...entriesRef.current, created]);
      setSelectedId(created.id);
      setTemplatePickerOpen(false);
      setStatus("");
    } catch (reason) { setStatus(reason.message); }
  }

  async function createEntriesFromTemplates(selectedTemplates) {
    if (!selectedTemplates.length) return;
    setTemplatePickerOpen(false);
    try {
      const createdEntries = [];
      let targetFolderId = "";
      const sourceFolderName = selectedTemplates[0]?.folderName?.trim();
      if (!api && sourceFolderName && sourceFolderName !== "미분류" && entryApi.createFolder) {
        const createdFolder = await entryApi.createFolder(project.id, sourceFolderName);
        targetFolderId = createdFolder.id;
        setFolders((current) => [...current, createdFolder]);
      }
      for (const template of selectedTemplates) {
        const emptyEntry = await entryApi.create(project.id);
        let created = await entryApi.save({ ...emptyEntry, title: template.title, keywords: template.keywords, content: template.content });
        if (targetFolderId) created = await entryApi.moveToFolder(project.id, created.id, targetFolderId);
        createdEntries.push(created);
      }
      replaceEntries([...entriesRef.current, ...createdEntries]);
      setSelectedId(createdEntries.at(-1).id);
      setStatus("");
    } catch (reason) { setStatus(reason.message); }
  }

  async function openTemplatePicker() {
    setTemplatePickerOpen(true);
    setTemplatesLoading(true);
    try { setTemplates(await window.aaa.lorebookTemplates.list("global-templates")); }
    catch (reason) { setStatus(reason.message); setTemplates([]); }
    finally { setTemplatesLoading(false); }
  }

  async function createFolder(name) {
    const created = await entryApi.createFolder(project.id, name);
    setFolders((current) => [...current, created]);
  }

  async function renameFolder(id, name) {
    const renamed = await entryApi.renameFolder(project.id, id, name);
    setFolders((current) => current.map((folder) => folder.id === id ? renamed : folder));
    replaceEntries(entriesRef.current.map((entry) => entry.folderId === id ? { ...entry, folderName: renamed.name } : entry));
  }

  async function deleteFolder(id) {
    await entryApi.deleteFolder(project.id, id);
    setFolders((current) => current.filter((folder) => folder.id !== id));
    replaceEntries(entriesRef.current.map((entry) => entry.folderId === id ? { ...entry, folderId: "", folderName: "" } : entry));
  }

  async function moveToFolder(id, folderId) {
    if (!id) return;
    const moved = await entryApi.moveToFolder(project.id, id, folderId);
    replaceEntries(entriesRef.current.map((entry) => entry.id === id ? moved : entry));
  }

  async function reorderTemplateEntry(sourceId, targetId, edge, folderId) {
    if (!sourceId || sourceId === targetId) return;
    try {
      let ordered = [...entriesRef.current].sort((left, right) => left.position - right.position);
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
      replaceEntries(reordered);
      await api.reorder(project.id, reordered.map((entry) => entry.id));
      setStatus("순서 저장됨");
    } catch (reason) { setStatus(reason.message); }
  }

  async function duplicateEntry(entry) {
    if (!entry) return;
    try {
      await saveEntry(entry);
      const copy = await entryApi.duplicate(entry.id, project.id);
      replaceEntries([...entriesRef.current, copy]);
      setSelectedId(copy.id);
      setStatus("사본을 만들었습니다.");
    } catch (reason) { setStatus(reason.message); }
  }

  async function copyContent(entry) {
    try { await navigator.clipboard.writeText(entry?.content || ""); setStatus("복사됨"); }
    catch { setStatus("클립보드에 복사하지 못했습니다."); }
  }

  async function deleteEntry() {
    if (!pendingDelete || deleting) return;
    const entry = pendingDelete;
    setDeleting(true);
    clearTimeout(saveTimers.current.get(entry.id));
    saveTimers.current.delete(entry.id);
    try {
      await entryApi.delete(entry.id, project.id);
      const remaining = entriesRef.current.filter((item) => item.id !== entry.id);
      replaceEntries(remaining);
      if (selectedId === entry.id) setSelectedId(remaining[0]?.id || null);
      setPendingDelete(null);
      setStatus("");
    } catch (reason) { setStatus(reason.message); }
    finally { setDeleting(false); }
  }

  async function moveEntry(targetId, edge = "before") {
    const sourceId = draggedId.current;
    draggedId.current = null;
    if (!sourceId || sourceId === targetId) return;
    const ordered = [...entriesRef.current].sort((left, right) => left.position - right.position);
    const sourceIndex = ordered.findIndex((entry) => entry.id === sourceId);
    if (sourceIndex < 0) return;
    const [source] = ordered.splice(sourceIndex, 1);
    const targetIndex = ordered.findIndex((entry) => entry.id === targetId);
    if (targetIndex < 0) return;
    ordered.splice(targetIndex + (edge === "after" ? 1 : 0), 0, source);
    const reordered = ordered.map((entry, position) => ({ ...entry, position }));
    replaceEntries(reordered);
    try { await entryApi.reorder(project.id, reordered.map((entry) => entry.id)); setStatus("순서 저장됨"); }
    catch (reason) { setStatus(reason.message); }
  }

  function updateSelection({ highlightWord = false } = {}) {
    const input = contentInput.current;
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
    const input = contentInput.current;
    if (codeView.current && input) codeView.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
  }

  function openTableDialog() {
    const input = contentInput.current;
    tableSelection.current = input ? { start: input.selectionStart, end: input.selectionEnd } : { start: selected?.content.length || 0, end: selected?.content.length || 0 };
    setTableDialog({});
  }

  function showTableContextMenu(event) {
    const existingTable = findMarkdownTable(selected?.content || "", event.currentTarget.selectionStart);
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
    if (!selected) return;
    const { start, end } = tableSelection.current;
    const before = selected.content.slice(0, start);
    const after = selected.content.slice(end);
    const editing = Boolean(tableDialog?.headers);
    const leadingBreak = editing || !before ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trailingBreak = editing || !after ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const compactCell = (cell) => cell.trim().replaceAll("|", "\\|").replaceAll("\n", " ");
    const header = `|${headers.map(compactCell).join("|")}|`;
    const divider = `|${headers.map(() => "-").join("|")}|`;
    const body = rows.map((row) => `|${row.map(compactCell).join("|")}|`).join("\n");
    updateEntry(selected.id, { content: `${before}${leadingBreak}${header}\n${divider}\n${body}${trailingBreak}${after}` });
    setTableDialog(null);
    const firstHeaderStart = start + leadingBreak.length + 1;
    requestAnimationFrame(() => {
      contentInput.current?.focus();
      contentInput.current?.setSelectionRange(firstHeaderStart, firstHeaderStart + headers[0].trim().length);
      updateSelection();
    });
  }

  function indentWithTab(event, entry) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const { selectionStart, selectionEnd, value } = event.currentTarget;
    updateEntry(entry.id, { content: `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}` });
    requestAnimationFrame(() => { contentInput.current?.setSelectionRange(selectionStart + 2, selectionStart + 2); updateSelection(); });
  }

  useEffect(() => {
    if (!tableContextMenu) return undefined;
    const closeMenu = () => setTableContextMenu(null);
    const closeWithEscape = (event) => event.key === "Escape" && closeMenu();
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeWithEscape);
    window.addEventListener("blur", closeMenu);
    return () => { window.removeEventListener("pointerdown", closeMenu); window.removeEventListener("keydown", closeWithEscape); window.removeEventListener("blur", closeMenu); };
  }, [tableContextMenu]);

  useEffect(() => {
    const listener = (event) => {
      const current = entriesRef.current.find((entry) => entry.id === selectedId);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && current) { event.preventDefault(); saveEntry(current); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [selectedId]);

  const sortedEntries = [...entries].sort((left, right) => left.position - right.position);
  const selected = entries.find((entry) => entry.id === selectedId) || null;
  const lines = (selected?.content || "").split("\n");

  return <><section className="prompt-workspace lorebook-workspace">
    {entryApi.listFolders ? <LorebookTemplateFolders entryLabel="로어북" folders={folders} entries={sortedEntries} selectedId={selectedId} onSelect={setSelectedId} onCreateEntry={createEntry} onCreateFolder={createFolder} onRenameFolder={renameFolder} onDeleteFolder={deleteFolder} onMove={moveToFolder} onReorder={reorderTemplateEntry} onOpenTemplates={!api ? openTemplatePicker : null} renderEntryMeta={(entry) => entry.keywords.length} compactActions={!api} /> : <aside className="prompt-sidebar"><div className="prompt-sidebar-heading"><strong>로어북</strong><button className="outline-button button-with-icon" onClick={() => createEntry()}><Plus size={16} />새 로어북</button>{!api && <button className="outline-button button-with-icon" onClick={openTemplatePicker}><LibraryBig size={16} />템플릿 로어북 추가</button>}</div><div className="prompt-list lorebook-sidebar-list">{loading ? <p>불러오는 중…</p> : sortedEntries.map((entry) => <button className={`lorebook-list-button ${entry.id === selectedId ? "active" : ""} ${dropIndicator?.id === entry.id ? `drop-${dropIndicator.edge}` : ""}`} key={entry.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; draggedId.current = entry.id; }} onDragEnd={() => setDropIndicator(null)} onDragOver={(event) => { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); setDropIndicator({ id: entry.id, edge: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" }); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropIndicator(null); }} onDrop={(event) => { event.preventDefault(); const edge = dropIndicator?.id === entry.id ? dropIndicator.edge : "before"; setDropIndicator(null); moveEntry(entry.id, edge); }} onClick={() => setSelectedId(entry.id)}><span className="lorebook-list-drag"><GripVertical size={17} /></span><span className="lorebook-list-copy"><strong>{entry.title}</strong></span><span className="lorebook-keyword-count" aria-label={`키워드 ${entry.keywords.length}개`}>{entry.keywords.length}</span></button>)}</div></aside>}
    <div className="lorebook-editor-column"><div className="prompt-editor">{selected ? <><header><input value={selected.title} onChange={(event) => updateEntry(selected.id, { title: event.target.value })} placeholder="로어북 제목" /><div><span className={status.includes("저장") || status.includes("사본") || status === "복사됨" ? "success" : "error"}>{status}</span><button className="outline-button editor-icon-button editor-table-action" aria-label="표 생성" data-tooltip="표 생성" onClick={() => markdownEditor.current?.openTableDialog()}><Table2 size={17} /></button><button className="outline-button editor-icon-button" aria-label="복사" data-tooltip="복사" onClick={() => copyContent(selected)}><ClipboardCopy size={17} /></button><button className="outline-button editor-icon-button" aria-label="사본 생성" data-tooltip="사본 생성" onClick={() => duplicateEntry(selected)}><Copy size={17} /></button><button className="outline-button editor-icon-button" aria-label="삭제" data-tooltip="삭제" onClick={() => setPendingDelete(selected)}><Trash2 size={17} /></button><button className="primary-button editor-icon-button" aria-label="저장" data-tooltip="저장" onClick={() => saveEntry(selected)}><Save size={17} /></button></div></header><MarkdownEditor ref={markdownEditor} value={selected.content} onChange={(content) => updateEntry(selected.id, { content })} /></> : <div className="prompt-empty"><p>로어북이 없습니다.</p></div>}</div><LorebookKeywords entry={selected} onChange={(changes) => selected && updateEntry(selected.id, changes)} /></div>
  </section>{templatePickerOpen && <TemplatePicker grouped fixedHeight title="템플릿 로어북 선택" templates={templates} loading={templatesLoading} onSelect={createEntry} onSelectGroup={createEntriesFromTemplates} onClose={() => setTemplatePickerOpen(false)} />}{pendingDelete && <DeleteConfirmModal title="로어북 삭제" target={pendingDelete.title || "제목 없는 로어북"} busy={deleting} onClose={() => setPendingDelete(null)} onConfirm={deleteEntry} />}</>;
}

export { Lorebooks };
