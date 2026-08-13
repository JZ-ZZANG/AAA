import { X } from "lucide-react";

function TemplatePicker({ title, templates, loading, onSelect, onSelectGroup, onClose, grouped = false, fixedHeight = false }) {
  const groups = grouped ? [...templates.reduce((result, template) => {
    const name = template.folderName?.trim() || "미분류";
    if (!result.has(name)) result.set(name, []);
    result.get(name).push(template);
    return result;
  }, new Map())] : [];

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal template-picker-modal">
      <div className="modal-heading"><h2>{title}</h2><button className="modal-close icon-button" aria-label="닫기" onClick={onClose}><X size={18} /></button></div>
      <div className={`template-picker-list ${fixedHeight ? "fixed-height" : ""} ${grouped ? "grouped" : ""}`}>
        {loading ? <p>불러오는 중…</p> : templates.length ? grouped ? groups.map(([name, entries]) => <section className="template-picker-group" key={name}><header><strong>{name}</strong><button className="outline-button" onClick={() => onSelectGroup(entries)}>그룹 전체 추가</button></header><div>{entries.map((template) => <button key={template.id} onClick={() => onSelect(template)}>{template.title}</button>)}</div></section>) : templates.map((template) => <button key={template.id} onClick={() => onSelect(template)}>{template.title}</button>) : <p>저장된 템플릿이 없습니다.</p>}
      </div>
    </section>
  </div>;
}

export { TemplatePicker };
