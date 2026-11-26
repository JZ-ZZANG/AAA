import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, FileArchive, FolderArchive, X } from "lucide-react";

function CharxExportDialog({ project, data, exporting, onClose, onExport }) {
  const [name, setName] = useState(data.name);
  const [creator, setCreator] = useState("");
  const [characterVersion, setCharacterVersion] = useState("");
  const [promptIds, setPromptIds] = useState(data.prompts.slice(0, 1).map((entry) => entry.id));
  const [firstSituationId, setFirstSituationId] = useState(data.situations[0]?.id || "");
  const [titleImageId, setTitleImageId] = useState(data.titleImages[0]?.id || "");
  const [includeAlternateGreetings, setIncludeAlternateGreetings] = useState(false);
  const [includeLorebooks, setIncludeLorebooks] = useState(true);
  const [includeAssets, setIncludeAssets] = useState(true);
  const [assetMode, setAssetMode] = useState("display");
  const [error, setError] = useState("");

  useEffect(() => {
    const listener = (event) => { if (event.key === "Escape" && !exporting) onClose(); };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [exporting, onClose]);

  function togglePrompt(id, checked) {
    setPromptIds((current) => checked ? [...current, id] : current.filter((item) => item !== id));
  }

  function movePrompt(index, offset) {
    setPromptIds((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onExport({ projectId: project.id, name, creator, characterVersion, promptIds, firstSituationId, titleImageId, includeAlternateGreetings, includeLorebooks, includeAssets, assetMode });
    } catch (reason) { setError(reason.message); }
  }

  const orderedPrompts = [...promptIds.map((id) => data.prompts.find((entry) => entry.id === id)), ...data.prompts.filter((entry) => !promptIds.includes(entry.id))];

  return <div className="modal-backdrop"><form className="modal charx-export-modal" role="dialog" aria-modal="true" aria-labelledby="charx-export-title" onSubmit={submit}>
    <div className="modal-heading"><h2 id="charx-export-title">CHARX로 내보내기</h2><button type="button" className="modal-close icon-button" aria-label="닫기" disabled={exporting} onClick={onClose}><X size={18} /></button></div>
    <fieldset className="charx-export-fields" disabled={exporting}>
      <div className="charx-metadata-grid">
        <label>카드 이름<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>제작자<input value={creator} onChange={(event) => setCreator(event.target.value)} placeholder="선택 사항" /></label>
        <label>작품 버전<input value={characterVersion} onChange={(event) => setCharacterVersion(event.target.value)} placeholder="예: 1.0" /></label>
      </div>
      <div className="charx-prompt-selection"><strong>내보낼 프롬프트</strong><p>선택한 프롬프트만 아래 순서대로 합쳐 메인 설정에 넣습니다.</p>
        <div className="charx-prompt-list">{orderedPrompts.length ? orderedPrompts.map((entry) => {
          const index = promptIds.indexOf(entry.id);
          return <div className="charx-prompt-row" key={entry.id}>
            <label><input type="checkbox" checked={index >= 0} onChange={(event) => togglePrompt(entry.id, event.target.checked)} /><span>{index >= 0 && <small>{index + 1}.</small>}{entry.folderName ? `${entry.folderName} / ` : ""}{entry.title}</span></label>
            {index >= 0 && <div><button type="button" className="outline-button icon-button" aria-label={`${entry.title} 위로 이동`} disabled={index === 0} onClick={() => movePrompt(index, -1)}><ArrowUp size={15} /></button><button type="button" className="outline-button icon-button" aria-label={`${entry.title} 아래로 이동`} disabled={index === promptIds.length - 1} onClick={() => movePrompt(index, 1)}><ArrowDown size={15} /></button></div>}
          </div>;
        }) : <p>저장된 프롬프트가 없습니다.</p>}</div>
      </div>
      <div className="charx-content-grid">
        <label>기본 시작 상황<select value={firstSituationId} onChange={(event) => setFirstSituationId(event.target.value)}><option value="">포함하지 않음</option>{data.situations.map((entry) => <option key={entry.id} value={entry.id}>{entry.folderName ? `${entry.folderName} / ` : ""}{entry.title}</option>)}</select></label>
        <label>대표 이미지<select value={titleImageId} onChange={(event) => setTitleImageId(event.target.value)}><option value="">포함하지 않음</option>{data.titleImages.map((image) => <option key={image.id} value={image.id}>{`Title${String(Number(image.position) + 1).padStart(3, "0")} · ${image.sourceName}`}</option>)}</select></label>
      </div>
      <div className="charx-export-options">
        <label className="checkbox-field"><input type="checkbox" checked={includeAlternateGreetings} onChange={(event) => setIncludeAlternateGreetings(event.target.checked)} />나머지 시작 상황도 대체 시작 메시지로 포함</label>
        <label className="checkbox-field"><input type="checkbox" checked={includeLorebooks} onChange={(event) => setIncludeLorebooks(event.target.checked)} />로어북 포함 ({data.lorebookCount}개)</label>
        <label className="checkbox-field"><input type="checkbox" checked={includeAssets} onChange={(event) => setIncludeAssets(event.target.checked)} />에셋 포함 ({data.assetCount}개)</label>
        {includeAssets && <label>에셋 이미지<select value={assetMode} onChange={(event) => setAssetMode(event.target.value)}><option value="display">검열본 우선</option><option value="original">원본</option></select><small>검열이 완료되지 않은 에셋은 원본을 포함합니다.</small></label>}
      </div>
    </fieldset>
    {error && <p className="error charx-export-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="text-button" disabled={exporting} onClick={onClose}>취소</button><button className="primary-button button-with-icon" disabled={exporting || !name.trim() || data.prompts.length > 0 && !promptIds.length}><Download size={17} />{exporting ? "내보내는 중…" : "CHARX 저장"}</button></div>
  </form></div>;
}

function ExportProject({ project }) {
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  const [charxData, setCharxData] = useState(null);
  const [loadingCharx, setLoadingCharx] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    setCharxData(null);
    setStatus("");
    setLoadingCharx(false);
    return () => { requestId.current += 1; };
  }, [project.id]);

  async function openCharxExport() {
    const request = ++requestId.current;
    setLoadingCharx(true);
    setStatus("");
    try {
      const data = await window.aaa.projects.charxOptions(project.id);
      if (request === requestId.current) setCharxData(data);
    } catch (reason) { if (request === requestId.current) setStatus(reason.message); }
    finally { if (request === requestId.current) setLoadingCharx(false); }
  }

  async function exportCharx(options) {
    setExporting(true);
    setStatus("");
    try {
      const outputPath = await window.aaa.projects.exportCharx(options);
      if (outputPath) { setStatus(`내보내기 완료: ${outputPath}`); setCharxData(null); }
    } finally { setExporting(false); }
  }

  async function exportProject() {
    setExporting(true);
    setStatus("");
    try {
      const outputPath = await window.aaa.projects.export(project.id);
      if (outputPath) setStatus(`내보내기 완료: ${outputPath}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setExporting(false);
    }
  }

  return <div className="export-page">
    <section className="export-section">
      <div className="export-section-heading"><h2>파일로 내보내기</h2></div>
      <div className="export-list">
        <article className="export-list-item">
          <div className="export-item-icon"><FolderArchive size={22} /></div>
          <div className="export-item-content"><strong>프로젝트 ZIP</strong><span>프로젝트를 ZIP파일로 저장합니다.</span></div>
          <button className="primary-button editor-icon-button export-item-action" aria-label="다운로드" data-tooltip="다운로드" disabled={exporting || loadingCharx} onClick={exportProject}><Download size={18} /></button>
        </article>
        <article className="export-list-item">
          <div className="export-item-icon"><FileArchive size={22} /></div>
          <div className="export-item-content"><strong>CHARX 캐릭터 카드</strong><span>프롬프트를 선택하여 로어북·시작 상황·이미지와 함께 저장합니다.</span></div>
          <button className="primary-button editor-icon-button export-item-action" aria-label="CHARX로 내보내기" data-tooltip="CHARX로 내보내기" disabled={exporting || loadingCharx} onClick={openCharxExport}><Download size={18} /></button>
        </article>
      </div>
      {status && <p className={`export-status ${status.startsWith("내보내기 완료") ? "success" : "error"}`}>{status}</p>}
    </section>
    {charxData && <CharxExportDialog project={project} data={charxData} exporting={exporting} onClose={() => setCharxData(null)} onExport={exportCharx} />}
  </div>;
}

export { ExportProject };
