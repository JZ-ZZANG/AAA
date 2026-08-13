import { useEffect, useRef, useState } from "react";
import { ClipboardCopy, Plus, Trash2, X } from "lucide-react";
import { MarkdownEditor } from "../components/MarkdownEditor.jsx";
import { DeleteConfirmModal } from "../components/Shell.jsx";

function Work({ project }) {
  const [work, setWork] = useState({ projectId: project.id, introduction: "", characterPreference: "ALL", ageRating: "SAFE", tags: [] });
  const [images, setImages] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [dragging, setDragging] = useState("");
  const [status, setStatus] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const loaded = useRef(false);
  const saveTimer = useRef(null);
  const workRef = useRef(work);

  async function loadTitleSlots() {
    setImages(await window.aaa.works.listImages(project.id));
  }

  useEffect(() => {
    loaded.current = false;
    Promise.all([window.aaa.works.get(project.id), window.aaa.works.listImages(project.id)]).then(([details, titleImages]) => {
      workRef.current = details;
      setWork(details);
      setImages(titleImages);
      loaded.current = true;
    }).catch((reason) => setStatus(reason.message));
    return () => { clearTimeout(saveTimer.current); if (loaded.current) window.aaa.works.save(workRef.current).catch(() => {}); };
  }, [project.id]);

  function updateWork(changes) {
    const next = { ...workRef.current, ...changes };
    workRef.current = next; setWork(next); setStatus("");
    if (!loaded.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => window.aaa.works.save(next).then(() => setStatus("자동 저장됨")).catch((reason) => setStatus(reason.message)), 600);
  }

  function addTag() { const tag = tagInput.trim().replaceAll(",", ""); if (tag && !work.tags.includes(tag)) updateWork({ tags: [...work.tags, tag] }); setTagInput(""); }
  async function copyIntroduction() { try { await navigator.clipboard.writeText(workRef.current.introduction || ""); setStatus("복사됨"); } catch { setStatus("클립보드에 복사하지 못했습니다."); } }

  async function addSlot() {
    try {
      const created = await window.aaa.works.createSlot(project.id);
      setImages((current) => [...current, created]);
    } catch (reason) { setStatus(reason.message); }
  }

  async function addImage(file, slotId) {
    if (!file?.type.startsWith("image/")) return;
    setStatus("이미지 저장 중…");
    try {
      const created = await window.aaa.works.addImage({ projectId: project.id, slotId, sourcePath: window.aaa.getPathForFile(file) });
      setImages((current) => current.map((slot) => slot.id === slotId ? created : slot));
      setStatus("타이틀 이미지가 저장됨");
    } catch (reason) { setStatus(reason.message); }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      if (deleteTarget.mode === "slot") await window.aaa.works.deleteSlot(project.id, deleteTarget.slot.id);
      else await window.aaa.works.deleteImage(project.id, deleteTarget.slot.id);
      await loadTitleSlots();
      setDeleteTarget(null);
      setStatus(deleteTarget.mode === "slot" ? "타이틀 블록을 삭제함" : "타이틀 이미지를 삭제함");
    } catch (reason) { setStatus(reason.message); }
    finally { setDeleting(false); }
  }

  async function requestSlotDelete(slot) {
    if (slot.savedPath) { setDeleteTarget({ mode: "slot", slot }); return; }
    try {
      await window.aaa.works.deleteSlot(project.id, slot.id);
      await loadTitleSlots();
      setStatus("타이틀 블록을 삭제함");
    } catch (reason) { setStatus(reason.message); }
  }

  return <section className="work-page">
    <div className="work-section"><div className="work-section-heading"><h2>타이틀 이미지</h2><div className="work-heading-actions">{status && <span className={`work-status ${status.includes("저장") || status.includes("삭제") ? "success" : "error"}`}>{status}</span>}<button className="outline-button button-with-icon" onClick={addSlot}><Plus size={16} />타이틀 추가</button></div></div><div className="board-grid work-title-grid">{images.map((slot) => <article className={`board-card ${dragging === slot.id ? "dragging" : ""}`} key={slot.id} onDragOver={(event) => { if (slot.savedPath) return; event.preventDefault(); setDragging(slot.id); }} onDragLeave={() => setDragging("")} onDrop={(event) => { if (slot.savedPath) return; event.preventDefault(); setDragging(""); addImage([...event.dataTransfer.files].find((file) => file.type.startsWith("image/")), slot.id); }}>
      {slot.savedPath ? <img src={`aaa-asset://${slot.id}?v=${encodeURIComponent(slot.createdAt)}`} /> : <div className="card-drop">이미지 드롭</div>}
      <div className="card-info"><strong>{`Title${String(Number(slot.position) + 1).padStart(3, "0")}`}</strong><small>{slot.sourceName || "이미지 없음"}</small><div className="work-title-actions">{slot.savedPath && <button className="asset-delete-button" aria-label={`${slot.sourceName} 이미지 삭제`} title="이미지만 삭제" onClick={() => setDeleteTarget({ mode: "image", slot })}><Trash2 size={15} /></button>}<button className="asset-delete-button" aria-label="타이틀 블록 삭제" title="블록 삭제" onClick={() => requestSlotDelete(slot)}><X size={15} /></button></div></div>
    </article>)}</div></div>
    <div className="work-section work-introduction-section"><div className="work-section-heading"><h2>소개 글</h2><button className="outline-button editor-icon-button" aria-label="복사" data-tooltip="복사" onClick={copyIntroduction}><ClipboardCopy size={17} /></button></div><MarkdownEditor value={work.introduction} onChange={(introduction) => updateWork({ introduction })} /></div>
    <div className="work-section work-audience-section"><h2>캐릭터 성향</h2><div className="work-audience-options">{[["전체", "ALL"], ["남성향", "MALE"], ["여성향", "FEMALE"]].map(([label, value]) => <button className={work.characterPreference === value ? "active" : ""} key={value} onClick={() => updateWork({ characterPreference: value })}>{label}</button>)}</div></div>
    <div className="work-section work-audience-section"><h2>이용자 설정</h2><div className="work-audience-options">{[["전체 이용가", "SAFE"], ["미성년자 이용불가", "UNSAFE"]].map(([label, value]) => <button className={work.ageRating === value ? "active" : ""} key={value} onClick={() => updateWork({ ageRating: value })}>{label}</button>)}</div></div>
    <div className="work-section"><h2>태그</h2><div className="work-tag-add"><input value={tagInput} onChange={(event) => setTagInput(event.target.value.replaceAll(",", ""))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addTag(); } }} placeholder="태그 입력" /><button className="outline-button" onClick={addTag}>추가</button></div><div className="lorebook-keyword-list">{work.tags.map((tag) => <span className="lorebook-keyword" key={tag}>{tag}<button aria-label={`${tag} 삭제`} onClick={() => updateWork({ tags: work.tags.filter((item) => item !== tag) })}><X size={13} /></button></span>)}</div></div>
    {deleteTarget && <DeleteConfirmModal title={deleteTarget.mode === "slot" ? "타이틀 블록 삭제" : "타이틀 이미지 삭제"} target={deleteTarget.slot.sourceName || `Title${String(Number(deleteTarget.slot.position) + 1).padStart(3, "0")}`} busy={deleting} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
  </section>;
}
export { Work };
