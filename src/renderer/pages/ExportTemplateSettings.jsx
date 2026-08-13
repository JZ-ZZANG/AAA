import { useEffect, useRef, useState } from "react";
import { Bookmark, CircleHelp, Copy, GripVertical, PanelRight, Plus, Trash2 } from "lucide-react";
import { JavaScriptEditor } from "../components/JavaScriptEditor.jsx";
import { DeleteConfirmModal } from "../components/Shell.jsx";
import { EntryFolders } from "../components/LorebookTemplateFolders.jsx";

const VARIABLES = [
  ["project.name", "프로젝트 이름"],
  ["work.introduction", "작품 소개"], ["work.characterPreference", "캐릭터 성향 (ALL/MALE/FEMALE)"], ["work.ageRating", "이용자 설정 (SAFE/UNSAFE)"], ["work.tags", "작품 태그 목록"],
  ["prompts.selected", "선택한 프롬프트"], ["prompts.selected.title", "선택한 프롬프트 제목"], ["prompts.selected.content", "선택한 프롬프트 내용"], ["prompts.items", "모든 프롬프트"], ["prompts.folders", "프롬프트 폴더와 폴더별 items"],
  ["situations.selected", "선택한 시작 상황"], ["situations.selected.title", "선택한 시작 상황 제목"], ["situations.selected.content", "선택한 시작 상황 내용"], ["situations.items", "모든 시작 상황"], ["situations.folders", "시작 상황 폴더와 폴더별 items"],
  ["lorebooks.selected", "선택한 로어북"], ["lorebooks.selected.title", "선택한 로어북 제목"], ["lorebooks.selected.content", "선택한 로어북 내용"], ["lorebooks.items", "모든 로어북"], ["lorebooks.folders", "로어북 폴더와 폴더별 items"],
  ["splitOnce(content, separator)", "첫 구분자를 기준으로 before/after 분리"],
  ["titleImg.selected", "선택한 타이틀 이미지"], ["titleImg.items", "선택 가능한 타이틀 이미지 목록"], ["titleImg.selected.name", "타이틀 이미지 이름"], ["titleImg.selected.file", "타이틀 이미지 파일"], ["titleImg.token", "선택한 타이틀 이미지 업로드 토큰"],
  ["assets.enabled", "에셋 업로드 기본 상태"],
  ["assets.items", "업로드 가능한 모든 에셋"], ["asset.name", "분류명으로 조합한 에셋 이름"], ["asset.classification", "분류 기준 이름과 선택값"], ["asset.file", "선택한 원본 또는 검열 에셋 파일"], ["asset.relativePath", "프로젝트 내 에셋 상대 경로"],
  ["assets.token", "전체 에셋 업로드 토큰"], ["assets.folders", "하위 폴더를 포함하는 에셋 폴더 묶음"], ["assetFolder.path", "에셋 폴더 전체 상대 경로"], ["assetFolder.token", "해당 폴더의 업로드 토큰"], ["assetFolder.items", "해당 폴더와 하위 폴더의 에셋"],
  ["assets.criteria", "에셋 분류 기준 목록"], ["assets.pathRule", "에셋 저장 규칙"]
];

const TEMPLATE_DECLARATION_EXAMPLE = `/* @aaa-template
{
  "version": 1,
  "description": "플랫폼의 새 캐릭터 등록 화면에서 실행하세요.",
  "inputs": [
    {
      "key": "world",
      "label": "세계관",
      "description": "플랫폼의 세계관 입력란에 넣을 프롬프트",
      "source": "prompts.items",
      "selection": "single"
    },
    {
      "key": "characters",
      "label": "캐릭터 목록",
      "description": "개별 캐릭터 프롬프트가 들어 있는 폴더",
      "source": "prompts.folders",
      "selection": "folder"
    }
  ]
}
@aaa-template-end */`;

function ExportTemplateHelpModal({ onClose }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal export-template-help-modal" role="dialog" aria-modal="true" aria-labelledby="export-template-help-title"><div className="modal-heading"><h2 id="export-template-help-title">템플릿 입력 선언 안내</h2><button className="modal-close" aria-label="설명 닫기" onClick={onClose}>×</button></div><div className="export-template-help-content"><section><h3>선언 형식</h3><p>템플릿 코드 맨 위의 특수 주석 안에 JSON 형식으로 입력 구조를 선언합니다. 앱은 실제 자동 입력 코드를 실행하기 전에 이 블록만 찾아 읽습니다.</p><pre><code>{TEMPLATE_DECLARATION_EXAMPLE}</code></pre></section><section><h3>각 요소의 의미</h3><dl><div><dt><code>@aaa-template</code></dt><dd>선언부의 시작을 앱에 알려 주는 표식입니다. 마지막은 <code>@aaa-template-end</code>로 닫습니다.</dd></div><div><dt><code>version</code></dt><dd>선언 형식의 버전입니다. 이후 구조가 변경될 때 구분하는 값입니다.</dd></div><div><dt><code>description</code></dt><dd>템플릿을 실행해야 하는 플랫폼 화면과 실행 전 준비사항을 적습니다. 내보내기 설정창의 최상단에 실행 안내로 표시됩니다.</dd></div><div><dt><code>inputs</code></dt><dd>이 템플릿이 사용자에게 선택받아야 하는 입력 항목 목록입니다.</dd></div><div><dt><code>key</code></dt><dd>템플릿 작성자가 정하는 입력 이름입니다. 기존 변수가 아니며, 예시의 <code>world</code>는 실행 코드에서 <code>inputs.world</code>로 전달됩니다.</dd></div><div><dt><code>label</code></dt><dd>브라우저 옵션에 표시할 항목 이름입니다.</dd></div><div><dt><code>description</code> (입력)</dt><dd>사용자가 해당 입력에서 어떤 자료를 선택해야 하는지 알려 주는 설명입니다.</dd></div><div><dt><code>source</code></dt><dd>변수 패널에 공개된 데이터 경로입니다. <code>choice</code> 입력에서는 생략하고, 그 외에는 <code>prompts.items</code>나 <code>prompts.folders</code>처럼 지정합니다.</dd></div><div><dt><code>selection</code></dt><dd><code>single</code>은 단일 항목, <code>folder</code>는 폴더 내부 항목, <code>all</code>은 전체 값, <code>boolean</code>은 사용 여부, <code>choice</code>는 템플릿이 선언한 선택지 중 하나를 전달합니다.</dd></div><div><dt><code>options</code></dt><dd><code>choice</code>에서 사용할 <code>value</code>와 표시용 <code>label</code> 목록입니다.</dd></div><div><dt><code>when</code></dt><dd>다른 입력의 선택값에 따라 현재 입력을 표시할 때 사용합니다. 기준 <code>key</code>와 허용할 <code>values</code>를 선언합니다.</dd></div></dl></section><section><h3>코드에서 사용</h3><p><code>world</code>나 <code>characters</code>의 의미를 앱이 추측하지 않습니다. 선언한 <code>source</code> 변수와 <code>selection</code>에 따라 사용자가 자료를 선택하고, 그 결과가 선언한 <code>key</code>에 들어갑니다.</p><pre><code>{`const worldContent = inputs.world.content;\n\nfor (const character of inputs.characters) {\n  console.log(character.title, character.content);\n}`}</code></pre></section></div><div className="modal-actions"><button className="primary-button" onClick={onClose}>확인</button></div></section></div>;
}

function ExportBookmarkModal({ onClose }) {
  const [bookmarks, setBookmarks] = useState([]);
  const [status, setStatus] = useState("");
  async function load() { setBookmarks(await window.aaa.exportBookmarks.list()); }
  useEffect(() => { load().catch((error) => setStatus(error.message)); }, []);
  function update(id, changes) { setBookmarks((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item)); }
  function create() { setBookmarks((current) => [...current, { id: `new-${crypto.randomUUID()}`, name: "", url: "" }]); setStatus(""); }
  async function remove(id) { try { if (!id.startsWith("new-")) await window.aaa.exportBookmarks.delete(id); setBookmarks((current) => current.filter((item) => item.id !== id)); setStatus(""); } catch (error) { setStatus(error.message); } }
  async function complete() {
    if (bookmarks.some((item) => !item.name.trim() || !item.url.trim())) { setStatus("즐겨찾기 이름과 주소를 모두 입력해 주세요."); return; }
    try {
      for (const bookmark of bookmarks) {
        const target = bookmark.id.startsWith("new-") ? await window.aaa.exportBookmarks.create() : bookmark;
        await window.aaa.exportBookmarks.save({ ...target, name: bookmark.name.trim(), url: bookmark.url.trim() });
      }
      onClose();
    } catch (error) { setStatus(error.message); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal export-bookmark-modal"><div className="modal-heading"><h2>즐겨찾기 관리</h2><button className="modal-close" onClick={onClose}>×</button></div><div className="export-bookmark-list">{bookmarks.map((bookmark) => <div className="export-bookmark-row" key={bookmark.id}><input value={bookmark.name} onChange={(event) => update(bookmark.id, { name: event.target.value })} placeholder="이름" /><input value={bookmark.url} onChange={(event) => update(bookmark.id, { url: event.target.value })} placeholder="example.com" /><button className="outline-button icon-button" aria-label="삭제" title="삭제" onClick={() => remove(bookmark.id)}><Trash2 size={16} /></button></div>)}</div>{!bookmarks.length && <div className="prompt-empty"><p>등록된 즐겨찾기가 없습니다.</p></div>}{status && <p className="error">{status}</p>}<div className="modal-actions"><button className="outline-button button-with-icon" onClick={create}><Plus size={16} />즐겨찾기 추가</button><button className="primary-button" onClick={complete}>완료</button></div></section></div>;
}

function ExportTemplateSettings() {
  const [templates, setTemplates] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState("");
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(true);
  const [dropIndicator, setDropIndicator] = useState(null);
  const scriptInput = useRef(null);
  const draftRef = useRef(null);
  const saveTimer = useRef(null);
  const dirty = useRef(false);
  const draggedId = useRef("");

  async function load(preferredId = "") {
    const [loaded, loadedFolders] = await Promise.all([window.aaa.exportTemplates.list(), window.aaa.exportTemplates.listFolders()]);
    setTemplates(loaded);
    setFolders(loadedFolders);
    const selected = loaded.find((item) => item.id === (preferredId || selectedId)) || loaded[0] || null;
    const nextDraft = selected ? structuredClone(selected) : null;
    setSelectedId(selected?.id || ""); setDraft(nextDraft); draftRef.current = nextDraft; dirty.current = false;
  }
  useEffect(() => { load().catch((error) => setStatus(error.message)); }, []);
  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    if (dirty.current && draftRef.current && !draftRef.current.builtIn) window.aaa.exportTemplates.save(draftRef.current).catch(() => {});
  }, []);
  async function persist(snapshot) {
    if (!snapshot || snapshot.builtIn) return;
    dirty.current = false; setStatus("저장 중");
    try {
      const saved = await window.aaa.exportTemplates.save(snapshot);
      setTemplates((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (draftRef.current?.id === saved.id) setStatus("자동 저장됨");
    } catch (error) { if (draftRef.current?.id === snapshot.id) setStatus(error.message); }
  }
  function flushPending() {
    clearTimeout(saveTimer.current);
    if (dirty.current) persist(draftRef.current);
  }
  function updateDraft(changes) {
    if (!draftRef.current || draftRef.current.builtIn) return;
    const next = { ...draftRef.current, ...changes };
    draftRef.current = next; setDraft(next); dirty.current = true; setStatus("저장 대기");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(next), 700);
  }
  function select(template) { flushPending(); const next = structuredClone(template); setSelectedId(template.id); setDraft(next); draftRef.current = next; dirty.current = false; setStatus(""); }
  async function create(source = null, folderId = "") { flushPending(); try { const created = await window.aaa.exportTemplates.create(source ? { ...source, folderId: source.folderId || folderId } : { folderId }); await load(created.id); setStatus(""); } catch (error) { setStatus(error.message); } }
  async function remove() {
    if (!deleteTarget || deleteTarget.builtIn || deleting) return;
    setDeleting(true);
    clearTimeout(saveTimer.current);
    dirty.current = false;
    try {
      await window.aaa.exportTemplates.delete(deleteTarget.id);
      setDeleteTarget(null);
      setSelectedId("");
      await load();
      setStatus("");
    } catch (error) { setStatus(error.message); }
    finally { setDeleting(false); }
  }
  async function reorder(sourceId, targetId, edge, folderId = "") {
    if (!sourceId || sourceId === targetId) return;
    const previous = templates;
    const ordered = [...templates];
    const sourceIndex = ordered.findIndex((item) => item.id === sourceId);
    if (sourceIndex < 0) return;
    let [source] = ordered.splice(sourceIndex, 1);
    if (source.folderId !== folderId) {
      source = await window.aaa.exportTemplates.moveToFolder(source.id, folderId);
    }
    const targetIndex = ordered.findIndex((item) => item.id === targetId);
    if (targetIndex < 0) return;
    ordered.splice(targetIndex + (edge === "after" ? 1 : 0), 0, source);
    const next = ordered.map((item, position) => ({ ...item, position }));
    setTemplates(next);
    try {
      const saved = await window.aaa.exportTemplates.reorder(next.map((item) => item.id));
      setTemplates(saved);
      setStatus("순서 저장됨");
    } catch (error) {
      setTemplates(previous);
      setStatus(error.message);
    }
  }
  async function createFolder(name) { const created = await window.aaa.exportTemplates.createFolder(name); setFolders((current) => [...current, created]); }
  async function renameFolder(id, name) { const renamed = await window.aaa.exportTemplates.renameFolder(id, name); setFolders((current) => current.map((folder) => folder.id === id ? renamed : folder)); setTemplates((current) => current.map((entry) => entry.folderId === id ? { ...entry, folderName: renamed.name } : entry)); }
  async function deleteFolder(id) { await window.aaa.exportTemplates.deleteFolder(id); setFolders((current) => current.filter((folder) => folder.id !== id)); setTemplates((current) => current.map((entry) => entry.folderId === id ? { ...entry, folderId: "", folderName: "" } : entry)); }
  async function moveToFolder(id, folderId) { const moved = await window.aaa.exportTemplates.moveToFolder(id, folderId); setTemplates((current) => current.map((entry) => entry.id === id ? { ...entry, folderId: moved.folderId, folderName: moved.folderName } : entry)); if (draftRef.current?.id === id) { const next = { ...draftRef.current, folderId: moved.folderId, folderName: moved.folderName }; draftRef.current = next; setDraft(next); } }
  function insert(text) {
    if (!draft || draft.builtIn) return;
    const input = scriptInput.current;
    const start = input?.selectionStart ?? draft.script.length;
    const end = input?.selectionEnd ?? start;
    updateDraft({ script: `${draft.script.slice(0, start)}${text}${draft.script.slice(end)}` });
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + text.length, start + text.length); });
  }

  return <section className="export-template-workspace">
    <EntryFolders entryLabel="내보내기 템플릿" folders={folders} entries={templates.map((template) => ({ ...template, title: template.name }))} selectedId={selectedId} onSelect={(id) => { const template = templates.find((entry) => entry.id === id); if (template) select(template); }} onCreateEntry={(folderId) => create(null, folderId)} onCreateFolder={createFolder} onRenameFolder={renameFolder} onDeleteFolder={deleteFolder} onMove={moveToFolder} onReorder={reorder} compactActions headerActions={<button className="outline-button editor-icon-button" aria-label="즐겨찾기 관리" data-tooltip="즐겨찾기 관리" onClick={() => setBookmarkOpen(true)}><Bookmark size={17} /></button>} />
    <main className="export-template-editor">{draft ? <><header><div><input readOnly={draft.builtIn} value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="템플릿 이름" /><span className={`template-kind ${draft.builtIn ? "built-in" : ""}`}>{draft.builtIn ? "기본 제공 템플릿" : "사용자 템플릿"}</span></div><div>{status && <span className={status.endsWith("저장됨") ? "success" : status === "저장 대기" || status === "저장 중" ? "" : "error"}>{status}</span>}<button className="outline-button icon-button export-panel-button" aria-label="템플릿 입력 선언 설명" title="템플릿 입력 선언 설명" onClick={() => setHelpOpen(true)}><CircleHelp size={17} /></button><button className={`outline-button icon-button export-panel-button ${variablesOpen ? "active" : ""}`} aria-label={variablesOpen ? "프로젝트 변수 패널 숨기기" : "프로젝트 변수 패널 보이기"} title={variablesOpen ? "변수 패널 숨기기" : "변수 패널 보이기"} onClick={() => setVariablesOpen((current) => !current)}><PanelRight size={17} /></button>{draft.builtIn ? <button className="primary-button button-with-icon" onClick={() => create(draft)}><Copy size={16} />복제하여 수정</button> : <button className="outline-button icon-button" aria-label="템플릿 삭제" title="삭제" onClick={() => setDeleteTarget(structuredClone(draft))}><Trash2 size={17} /></button>}</div></header><div className={`export-script-layout ${variablesOpen ? "" : "reference-collapsed"}`}><section className="export-script-editor"><label className="js-code-field"><span>자동 입력 코드</span><JavaScriptEditor inputRef={scriptInput} readOnly={draft.builtIn} value={draft.script || ""} onChange={(script) => updateDraft({ script })} /></label></section>{variablesOpen && <aside className="export-script-reference"><section><strong>프로젝트 변수</strong><div className="script-token-list">{VARIABLES.map(([variable, description]) => <button disabled={draft.builtIn} title={description} key={variable} onClick={() => insert(variable)}><code>{variable}</code><span>{description}</span></button>)}</div></section></aside>}</div></> : <div className="prompt-empty"><p>내보내기 템플릿이 없습니다.</p></div>}</main>
    {bookmarkOpen && <ExportBookmarkModal onClose={() => setBookmarkOpen(false)} />}
    {helpOpen && <ExportTemplateHelpModal onClose={() => setHelpOpen(false)} />}
    {deleteTarget && <DeleteConfirmModal title="내보내기 템플릿 삭제" target={deleteTarget.name} busy={deleting} onClose={() => setDeleteTarget(null)} onConfirm={remove} />}
  </section>;
}

export { ExportTemplateSettings };
