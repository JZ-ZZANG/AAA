import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, Copy, Eraser, Home as HomeIcon, LayoutGrid, Minus, Paintbrush, RectangleHorizontal, RectangleVertical, RotateCcw, Settings as SettingsIcon, Square, Trash2, X } from "lucide-react";
import { combinations, renderPath, withoutExtension } from "../shared";
import { DeleteConfirmModal } from "../components/Shell";

function Classification({ project, refreshVersion, layout, onLayoutChange }) {
  const pathSegments = project.pathTemplate.split(/[\\/]/);
  const firstFolderTemplate = pathSegments.length > 1 ? pathSegments[0] : "";
  const remainingFolderTemplate = pathSegments.length > 2 ? pathSegments.slice(1, -1).join("/") : "";
  const fileTemplate = pathSegments.at(-1) || "";
  const sidebarTags = project.tags.filter((tag) => firstFolderTemplate.includes(`{tag:${tag.id}}`));
  const filterTags = project.tags.filter((tag) => remainingFolderTemplate.includes(`{tag:${tag.id}}`) && !sidebarTags.includes(tag));
  const folderTags = [...sidebarTags, ...filterTags];
  const fileTags = project.tags.filter((tag) => fileTemplate.includes(`{tag:${tag.id}}`) && !folderTags.includes(tag));
  const [folderSelections, setFolderSelections] = useState(() => Object.fromEntries(folderTags.map((tag) => [tag.id, tag.values[0]?.id || ""])));
  const [assets, setAssets] = useState([]);
  const [status, setStatus] = useState("");
  const [draggingCard, setDraggingCard] = useState("");
  const [savingCard, setSavingCard] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const cards = useMemo(() => combinations(fileTags), [fileTags]);
  const sidebarOptions = useMemo(() => combinations(sidebarTags), [sidebarTags]);
  const ratioLabels = { square: "정사각형", portrait: "세로", landscape: "가로" };

  function ValueCaption({ value }) {
    const label = value.label || value.value;
    return label === value.value ? label : <><span>{label}</span><span className="classification-value">{value.value}</span></>;
  }

  function SelectionCaption({ tags, selections }) {
    const values = tags.map((tag) => {
      const value = tag.values.find((item) => item.id === selections[tag.id]);
      return value || null;
    }).filter(Boolean);
    return values.map((value, index) => <span className="classification-selection" key={value.id}>{index > 0 && <span className="classification-separator"> · </span>}<ValueCaption value={value} /></span>);
  }

  function cycleColumns() {
    onLayoutChange({ ...layout, columns: layout.columns === 5 ? 3 : layout.columns + 1 });
  }

  function cycleRatio() {
    const next = layout.ratio === "square" ? "portrait" : layout.ratio === "portrait" ? "landscape" : "square";
    onLayoutChange({ ...layout, ratio: next });
  }

  useEffect(() => { window.aaa.assets.list(project.id).then(setAssets).catch((error) => setStatus(error.message)); }, [project.id, refreshVersion]);

  async function classifyFile(file, card, cardKey, overwrite = false) {
    setSavingCard(cardKey);
    try {
      const selections = { ...folderSelections, ...card.selections };
      const result = await window.aaa.assets.classify({ projectId: project.id, sourcePath: window.aaa.getPathForFile(file), selections, overwrite });
      if (result.collision) {
        if (confirm(`${result.relativePath} 파일이 이미 있습니다. 교체할까요?`)) await classifyFile(file, card, cardKey, true);
        return;
      }
      setAssets(await window.aaa.assets.list(project.id));
      setStatus(`${result.relativePath} 저장됨`);
    } catch (reason) { setStatus(reason.message); }
    finally { setSavingCard(""); }
  }

  async function deleteAsset() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await window.aaa.assets.delete(deleteTarget.id);
      setAssets((current) => current.filter((asset) => asset.id !== deleteTarget.id));
      setDeleteTarget(null);
      setStatus("이미지를 삭제했습니다.");
    } catch (reason) { setStatus(reason.message); }
    finally { setDeleting(false); }
  }

  function cardAsset(card) {
    const expected = withoutExtension(renderPath(project, { ...folderSelections, ...card.selections }));
    return assets.find((asset) => withoutExtension(asset.relativePath) === expected);
  }

  if (!project.tags.length || !project.pathTemplate) return <div className="empty-state">관리에서 에셋 분류 기준과 에셋 저장 규칙을 추가하세요.</div>;
  return <><div className="asset-board with-sidebar" style={{ "--board-columns": layout.columns, "--asset-ratio": layout.ratio === "portrait" ? "832 / 1216" : layout.ratio === "landscape" ? "1216 / 832" : "1 / 1" } as React.CSSProperties}>
    <aside className="board-sidebar"><div className="sidebar-layout-controls"><button aria-label={`${layout.columns}단`} data-tooltip={`${layout.columns}단`} onClick={cycleColumns}><LayoutGrid size={17} /><span>{layout.columns}</span></button><button aria-label={ratioLabels[layout.ratio]} data-tooltip={ratioLabels[layout.ratio]} onClick={cycleRatio}>{layout.ratio === "landscape" ? <RectangleHorizontal size={19} /> : layout.ratio === "portrait" ? <RectangleVertical size={19} /> : <Square size={17} />}</button></div>{sidebarTags.length > 0 && <><strong>{sidebarTags.map((tag) => tag.name).join(" · ")}</strong>{sidebarOptions.map((option) => { const active = Object.entries(option.selections).every(([tagId, valueId]) => folderSelections[tagId] === valueId); return <button className={active ? "active" : ""} key={Object.values(option.selections).join(":")} onClick={() => setFolderSelections({ ...folderSelections, ...option.selections })}><SelectionCaption tags={sidebarTags} selections={option.selections} /></button>; })}</>}</aside>
    <section className="board-content">
      {filterTags.length > 0 && <div className="board-filters">{filterTags.map((tag) => <div className="filter-group" key={tag.id}><strong>{tag.name}</strong><div>{tag.values.map((value) => <button className={folderSelections[tag.id] === value.id ? "active" : ""} key={value.id} onClick={() => setFolderSelections({ ...folderSelections, [tag.id]: value.id })}><ValueCaption value={value} /></button>)}</div></div>)}</div>}
      {status && <p className="board-status">{status}</p>}
      <div className="board-grid">{cards.map((card, index) => {
        const cardKey = Object.values(card.selections).join(":") || String(index);
        const existing = cardAsset(card);
        const expectedPath = renderPath(project, { ...folderSelections, ...card.selections });
        const displayedName = existing ? existing.relativePath.split(/[\\/]/).at(-1) : expectedPath.split("\\").at(-1);
        return <article
          className={`board-card ${draggingCard === cardKey ? "dragging" : ""}`}
          key={cardKey}
          onDragOver={(event) => { event.preventDefault(); setDraggingCard(cardKey); }}
          onDragLeave={() => setDraggingCard("")}
          onDrop={(event) => { event.preventDefault(); setDraggingCard(""); const file = [...event.dataTransfer.files].find((item) => item.type.startsWith("image/")); if (file) classifyFile(file, card, cardKey); }}
        >
          {existing ? <img src={`aaa-asset://${existing.id}?v=${encodeURIComponent(existing.modifiedAt)}`} onError={() => { setAssets((current) => current.filter((asset) => asset.id !== existing.id)); window.aaa.assets.forget(existing.id).catch(() => {}); }} /> : <div className="card-drop">{savingCard === cardKey ? "저장 중" : "이미지 드롭"}</div>}
          <div className="card-info"><strong>{card.labels.join(" · ") || "이미지"}</strong><small>{displayedName}</small>{existing && <button className="asset-delete-button" aria-label={`${displayedName} 삭제`} title="이미지 삭제" onClick={() => setDeleteTarget(existing)}><Trash2 size={15} /></button>}</div>
          {existing && <span className="registered">등록됨</span>}
        </article>;
      })}</div>
    </section>
  </div>{deleteTarget && <DeleteConfirmModal title="이미지 삭제" target={deleteTarget.relativePath} busy={deleting} onClose={() => setDeleteTarget(null)} onConfirm={deleteAsset} />}</>;
}

export { Classification };
