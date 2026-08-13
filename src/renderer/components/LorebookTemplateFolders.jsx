import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, FolderPlus, GripVertical, LibraryBig, Pencil, Plus, Trash2, X } from "lucide-react";

function EntrySidebar({ entryLabel, folders, entries, selectedId, onSelect, onCreateEntry, onCreateFolder, onRenameFolder, onDeleteFolder, onMove, onReorder, onOpenTemplates = null, renderEntryMeta = null, headerActions = null }) {
  const compactActions = true;
  const [expanded, setExpanded] = useState(() => new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [dropIndicator, setDropIndicator] = useState(null);
  const draggedId = useRef(null);

  useEffect(() => setExpanded((current) => new Set([...current, ...folders.map((folder) => folder.id)])), [folders.length]);

  function toggle(id) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submitFolder() {
    if (!newName.trim()) return;
    await onCreateFolder(newName.trim());
    setNewName("");
    setCreating(false);
  }

  async function submitRename(folder) {
    if (editingName.trim() && editingName.trim() !== folder.name) await onRenameFolder(folder.id, editingName.trim());
    setEditingId(null);
  }

  function entryButton(entry, folderId) {
    const meta = renderEntryMeta?.(entry);
    return <button className={`lorebook-list-button template-folder-entry ${entry.id === selectedId ? "active" : ""} ${dropIndicator?.id === entry.id ? `drop-${dropIndicator.edge}` : ""}`} key={entry.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; draggedId.current = entry.id; event.dataTransfer.setData("text/plain", entry.id); }} onDragEnd={() => { draggedId.current = null; setDropIndicator(null); }} onDragOver={(event) => { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); setDropIndicator({ id: entry.id, edge: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" }); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropIndicator(null); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const sourceId = draggedId.current || event.dataTransfer.getData("text/plain"); const edge = dropIndicator?.id === entry.id ? dropIndicator.edge : "before"; draggedId.current = null; setDropIndicator(null); onReorder(sourceId, entry.id, edge, folderId); }} onClick={() => onSelect(entry.id)}><span className="lorebook-list-drag"><GripVertical size={17} /></span><span className="lorebook-list-copy"><strong>{entry.title}</strong></span>{meta !== null && meta !== undefined && <span className="lorebook-keyword-count">{meta}</span>}</button>;
  }

  function folderSection(folder, folderEntries) {
    const isRoot = folder.id === "root";
    const isOpen = expanded.has(folder.id);
    return <section className="template-folder" key={folder.id}>
      <div className="template-folder-row" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const sourceId = draggedId.current || event.dataTransfer.getData("text/plain"); draggedId.current = null; setDropIndicator(null); onMove(sourceId, isRoot ? "" : folder.id); }}>
        <button className="template-folder-toggle" onClick={() => toggle(folder.id)}>{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
        {editingId === folder.id ? <input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitRename(folder); if (event.key === "Escape") setEditingId(null); }} onBlur={() => submitRename(folder)} /> : <button className="template-folder-name" onClick={() => toggle(folder.id)}>{folder.name}</button>}
        <button className="template-folder-action" aria-label={`폴더에 ${entryLabel} 추가`} data-tooltip={`${entryLabel} 추가`} onClick={() => onCreateEntry(isRoot ? "" : folder.id)}><Plus size={14} /></button>
        {!isRoot && <><button className="template-folder-action" aria-label="폴더 이름 변경" data-tooltip="이름 변경" onClick={() => { setEditingId(folder.id); setEditingName(folder.name); }}><Pencil size={14} /></button><button className="template-folder-action danger" aria-label="폴더 삭제" data-tooltip="폴더 삭제" onClick={() => onDeleteFolder(folder.id)}><Trash2 size={14} /></button></>}
      </div>
      {isOpen && <div className="template-folder-entries">{folderEntries.map((entry) => entryButton(entry, folder.id))}</div>}
    </section>;
  }

  const unfiled = entries.filter((entry) => !entry.folderId);
  const compactHeader = <div className="prompt-sidebar-actions">
    <button className="outline-button editor-icon-button" aria-label={`새 ${entryLabel}`} data-tooltip={`새 ${entryLabel}`} onClick={() => onCreateEntry("")}><Plus size={17} /></button>
    <button className="outline-button editor-icon-button" aria-label="새 폴더" data-tooltip="새 폴더" onClick={() => setCreating(true)}><FolderPlus size={17} /></button>
    {onOpenTemplates && <button className="outline-button editor-icon-button" aria-label={`템플릿 ${entryLabel} 추가`} data-tooltip={`템플릿 ${entryLabel} 추가`} onClick={onOpenTemplates}><LibraryBig size={17} /></button>}
    {headerActions}
  </div>;
  return <aside className="prompt-sidebar template-folder-sidebar">
    <div className="prompt-sidebar-heading"><strong>{entryLabel}</strong>{compactActions ? compactHeader : <><button className="outline-button button-with-icon" onClick={() => onCreateEntry("")}><Plus size={16} />새 {entryLabel}</button><button className="outline-button button-with-icon" onClick={() => setCreating(true)}><Plus size={16} />새 폴더</button>{onOpenTemplates && <button className="outline-button button-with-icon" onClick={onOpenTemplates}><Plus size={16} />템플릿 {entryLabel} 추가</button>}{headerActions}</>}{creating && <div className="template-folder-create"><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitFolder(); if (event.key === "Escape") setCreating(false); }} placeholder="폴더 이름" /><button onClick={submitFolder}><Check size={14} /></button><button onClick={() => setCreating(false)}><X size={14} /></button></div>}</div>
    <div className="prompt-list template-folder-list">
      {folders.map((folder) => folderSection(folder, entries.filter((entry) => entry.folderId === folder.id)))}
      <div className="template-unfiled-entries">{unfiled.map((entry) => entryButton(entry, ""))}</div>
    </div>
  </aside>;
}

const EntryFolders = EntrySidebar;
const LorebookTemplateFolders = EntrySidebar;

export { EntrySidebar, EntryFolders, LorebookTemplateFolders };
