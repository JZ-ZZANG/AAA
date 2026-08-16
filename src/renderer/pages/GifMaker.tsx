import { useEffect, useRef, useState } from "react";
import { Clock3, Copy, ImagePlus, Layers3, Save, Trash2 } from "lucide-react";
import { ProjectTitlebarNav } from "../components/Shell";

const makeTrack = () => ({ id: crypto.randomUUID(), frames: [] });
const makeFrame = (path) => ({ id: crypto.randomUUID(), path, duration: 500 });
const MAX_TRACKS = 3;

function fileName(filePath) {
  return filePath.split(/[\\/]/).at(-1) || filePath;
}

function fileSize(value) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function playbackTime(value) {
  const seconds = Math.max(0, Number(value) || 0) / 1000;
  if (seconds < 60) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}초`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}분 ${Number.isInteger(remainder) ? remainder : remainder.toFixed(1)}초`;
}

function timelinePlaybackTime(tracks) {
  return Math.max(0, ...tracks.map((track) => track.frames.reduce((total, frame) => total + Math.max(0, Number(frame.duration) || 0), 0)));
}

function LocalImage({ path, alt }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    window.aaa.gifs.previewUrl(path).then((value) => { if (active) setSource(value); }).catch(() => {});
    return () => { active = false; };
  }, [path]);
  return source ? <img src={source} alt={alt} /> : null;
}

function GifMaker({ onBack }) {
  const [tracks, setTracks] = useState(() => [makeTrack()]);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingPreview, setUpdatingPreview] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewQuality, setPreviewQuality] = useState(100);
  const [previewFormat, setPreviewFormat] = useState("webp");
  const [status, setStatus] = useState("");
  const [quality, setQuality] = useState(100);
  const [batchDuration, setBatchDuration] = useState(500);
  const [dropTarget, setDropTarget] = useState(null);
  const draggedItem = useRef(null);
  const previewRef = useRef(null);

  useEffect(() => () => {
    if (previewRef.current?.token) window.aaa.gifs.discardPreview(previewRef.current.token).catch(() => {});
  }, []);

  async function addFrames(trackId) {
    const paths = await window.aaa.gifs.chooseImages();
    if (!paths?.length) return;
    setTracks((current) => current.map((track) => track.id === trackId
      ? { ...track, frames: [...track.frames, ...paths.map(makeFrame)] }
      : track));
  }

  function updateFrame(trackId, frameId, changes) {
    setTracks((current) => current.map((track) => track.id === trackId
      ? { ...track, frames: track.frames.map((frame) => frame.id === frameId ? { ...frame, ...changes } : frame) }
      : track));
  }

  function duplicateFrame(trackId, frameId) {
    setTracks((current) => current.map((track) => {
      if (track.id !== trackId) return track;
      const index = track.frames.findIndex((frame) => frame.id === frameId);
      if (index < 0) return track;
      const copy = { ...track.frames[index], id: crypto.randomUUID() };
      return { ...track, frames: [...track.frames.slice(0, index + 1), copy, ...track.frames.slice(index + 1)] };
    }));
  }

  function deleteFrame(trackId, frameId) {
    setTracks((current) => current.map((track) => track.id === trackId
      ? { ...track, frames: track.frames.filter((frame) => frame.id !== frameId) }
      : track));
  }

  function applyBatchDuration() {
    setTracks((current) => current.map((track) => ({
      ...track,
      frames: track.frames.map((frame) => ({ ...frame, duration: batchDuration }))
    })));
  }

  function droppedImagePaths(event) {
    return [...event.dataTransfer.files]
      .map((file) => window.aaa.getPathForFile(file))
      .filter((path) => /\.(png|jpe?g|webp|avif|gif|bmp)$/i.test(path));
  }

  function appendDroppedFiles(event, trackId) {
    const paths = droppedImagePaths(event);
    if (!paths.length) return;
    setTracks((current) => current.map((track) => track.id === trackId
      ? { ...track, frames: [...track.frames, ...paths.map(makeFrame)] }
      : track));
  }

  function moveFrame(targetTrackId, targetFrameId = null, edge = "after") {
    const dragged = draggedItem.current;
    draggedItem.current = null;
    setDropTarget(null);
    if (!dragged) return;

    setTracks((current) => {
      const sourceTrack = current.find((track) => track.id === dragged.trackId);
      const source = sourceTrack?.frames.find((frame) => frame.id === dragged.frameId);
      if (!source || (dragged.trackId === targetTrackId && dragged.frameId === targetFrameId)) return current;

      return current.map((track) => {
        let frames = track.frames;
        if (track.id === dragged.trackId) frames = frames.filter((frame) => frame.id !== dragged.frameId);
        if (track.id === targetTrackId) {
          const targetIndex = targetFrameId ? frames.findIndex((frame) => frame.id === targetFrameId) : frames.length;
          const insertAt = targetIndex < 0 ? frames.length : targetIndex + (targetFrameId && edge === "after" ? 1 : 0);
          frames = [...frames.slice(0, insertAt), source, ...frames.slice(insertAt)];
        }
        return frames === track.frames ? track : { ...track, frames };
      });
    });
  }

  function dropOnTrack(event, trackId) {
    event.preventDefault();
    if (draggedItem.current) moveFrame(trackId);
    else appendDroppedFiles(event, trackId);
  }

  async function create() {
    if (!tracks.some((track) => track.frames.length) || creating) return;
    setCreating(true);
    setStatus("");
    try {
      const result = await window.aaa.gifs.createPreview({
        tracks: tracks.map((track) => ({ frames: track.frames.map(({ path, duration }) => ({ path, duration })) })),
        format: "webp",
        quality
      });
      previewRef.current = result;
      setPreview(result);
      setPreviewQuality(result.quality);
      setPreviewFormat(result.format);
    } catch (reason) { setStatus(reason.message); }
    finally { setCreating(false); }
  }

  async function updatePreview() {
    if (!preview || updatingPreview || (previewQuality === preview.quality && previewFormat === preview.format)) return;
    setUpdatingPreview(true);
    try {
      const result = await window.aaa.gifs.updatePreview(preview.token, { quality: previewQuality, format: previewFormat });
      previewRef.current = result;
      setPreview(result);
      setQuality(result.quality);
    } catch (reason) { setStatus(reason.message); }
    finally { setUpdatingPreview(false); }
  }

  async function closePreview() {
    if (!preview || saving) return;
    await window.aaa.gifs.discardPreview(preview.token).catch(() => {});
    previewRef.current = null;
    setPreview(null);
  }

  async function savePreview() {
    if (!preview || saving) return;
    setSaving(true);
    try {
      let currentPreview = preview;
      if (previewQuality !== preview.quality || previewFormat !== preview.format) {
        setUpdatingPreview(true);
        currentPreview = await window.aaa.gifs.updatePreview(preview.token, { quality: previewQuality, format: previewFormat });
        previewRef.current = currentPreview;
        setPreview(currentPreview);
        setQuality(currentPreview.quality);
        setUpdatingPreview(false);
      }
      const result = await window.aaa.gifs.savePreview(currentPreview.token);
      if (!result) return;
      previewRef.current = null;
      setPreview(null);
      setStatus("저장됨");
    } catch (reason) { setStatus(reason.message); }
    finally { setUpdatingPreview(false); setSaving(false); }
  }

  return <>
    <ProjectTitlebarNav project={null} tab="gif-maker" onHome={onBack} />
    <main className="page gif-maker-page">
      <header className="gif-maker-heading">
        <h1>움짤 생성</h1>
        <div className="gif-timeline-tools">
          <label>일괄 시간<input type="number" min="0" max="65535" step="100" value={batchDuration} onChange={(event) => setBatchDuration(Math.max(0, Math.min(65535, Number(event.target.value) || 0)))} /><span>ms</span></label>
          <button className="outline-button editor-icon-button" aria-label="전체 시간 적용" data-tooltip="전체 시간 적용" disabled={!tracks.some((track) => track.frames.length)} onClick={applyBatchDuration}><Clock3 size={18} /></button>
          <button className="outline-button editor-icon-button" aria-label="레이어 추가" data-tooltip={tracks.length >= MAX_TRACKS ? "레이어는 최대 3개까지 추가할 수 있습니다" : "레이어 추가"} disabled={tracks.length >= MAX_TRACKS} onClick={() => setTracks((current) => current.length >= MAX_TRACKS ? current : [makeTrack(), ...current])}><Layers3 size={18} /></button>
        </div>
        <div className="gif-output-tools">
          {status && <span className={status === "저장됨" ? "success" : "error"}>{status}</span>}
          <button className="primary-button editor-icon-button" aria-label={`저장`} data-tooltip={creating ? "생성 중" : `저장`} disabled={!tracks.some((track) => track.frames.length) || creating} onClick={create}><Save size={18} /></button>
        </div>
      </header>

      <section className="gif-timeline">
        {tracks.map((track, trackIndex) => <div className="gif-timeline-row" key={track.id}>
          <div className="gif-track-controls">
            <span>{tracks.length - trackIndex}</span>
            <button className="outline-button editor-icon-button" aria-label="이미지 추가" data-tooltip="이미지 추가" onClick={() => addFrames(track.id)}><ImagePlus size={18} /></button>
            {tracks.length > 1 && <button className="outline-button editor-icon-button" aria-label="레이어 삭제" data-tooltip="레이어 삭제" onClick={() => setTracks((current) => current.filter((item) => item.id !== track.id))}><Trash2 size={18} /></button>}
          </div>
          <div className="gif-frame-list" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOnTrack(event, track.id)}>
            {track.frames.map((frame, index) => <article
              className={`gif-frame-card ${dropTarget?.frameId === frame.id ? `drop-${dropTarget.edge}` : ""}`}
              key={frame.id}
              onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); const bounds = event.currentTarget.getBoundingClientRect(); setDropTarget({ frameId: frame.id, edge: event.clientX < bounds.left + bounds.width / 2 ? "before" : "after" }); }}
              onDrop={(event) => { event.preventDefault(); event.stopPropagation(); moveFrame(track.id, frame.id, dropTarget?.edge || "before"); }}
            >
              <span className="gif-frame-index">{index + 1}</span>
              <div
                className="gif-frame-preview"
                draggable
                onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; draggedItem.current = { trackId: track.id, frameId: frame.id }; }}
                onDragEnd={() => { draggedItem.current = null; setDropTarget(null); }}
              ><LocalImage path={frame.path} alt={fileName(frame.path)} /></div>
              <div className="gif-frame-fields">
                <strong title={fileName(frame.path)}>{fileName(frame.path)}</strong>
                <label><input aria-label="표시 시간" type="number" min="0" max="65535" step="100" value={frame.duration} onChange={(event) => updateFrame(track.id, frame.id, { duration: Math.max(0, Math.min(65535, Number(event.target.value) || 0)) })} /><span>ms</span></label>
              </div>
              <div className="gif-frame-actions">
                <button className="outline-button editor-icon-button" aria-label="복사" data-tooltip="복사" onClick={() => duplicateFrame(track.id, frame.id)}><Copy size={17} /></button>
                <button className="outline-button editor-icon-button" aria-label="삭제" data-tooltip="삭제" onClick={() => deleteFrame(track.id, frame.id)}><Trash2 size={17} /></button>
              </div>
            </article>)}
          </div>
        </div>)}
      </section>
    </main>
    {preview && <div className="modal-backdrop"><section className="modal gif-result-preview-modal"><div className="modal-heading"><h2>움짤 미리보기</h2><button className="modal-close" disabled={saving || updatingPreview} onClick={closePreview}>×</button></div>{preview.previewable ? <div className="gif-result-preview"><img src={preview.url} alt="생성된 움짤 미리보기" /></div> : <div className="gif-preview-skipped"><strong>대용량 미리보기 생략</strong><p>결과물이 커서 안정적인 메모리 사용을 위해 애니메이션 재생을 생략했습니다. 파일은 정상적으로 생성되었습니다.</p></div>}<div className="gif-preview-quality"><label>저장 형식<select value={previewFormat} disabled={updatingPreview || saving} onChange={(event) => setPreviewFormat(event.target.value)}><option value="webp">WEBP</option><option value="gif">GIF</option></select></label><label>품질<input type="number" min="1" max="100" value={previewQuality} disabled={updatingPreview || saving} onWheel={(event) => { event.preventDefault(); event.stopPropagation(); setPreviewQuality((current) => Math.max(1, Math.min(100, current + (event.deltaY < 0 ? 1 : -1)))); }} onChange={(event) => setPreviewQuality(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} /></label><button className="outline-button" disabled={updatingPreview || saving || (previewQuality === preview.quality && previewFormat === preview.format)} onClick={updatePreview}>{updatingPreview ? "생성 중" : "미리보기 재생성"}</button></div><dl className="gif-result-details"><div><dt>파일 용량</dt><dd>{fileSize(preview.fileSize)}</dd></div><div><dt>재생 시간</dt><dd>{playbackTime(preview.durationMs > 0 ? preview.durationMs : timelinePlaybackTime(tracks))}</dd></div><div><dt>품질</dt><dd>{preview.quality}</dd></div><div><dt>크기</dt><dd>{preview.width} × {preview.height}</dd></div><div><dt>프레임</dt><dd>{preview.frames}</dd></div><div><dt>형식</dt><dd>{preview.format.toUpperCase()}</dd></div></dl><div className="modal-actions"><button className="text-button" disabled={saving || updatingPreview} onClick={closePreview}>취소</button><button className="primary-button" disabled={saving || updatingPreview} onClick={savePreview}>{saving ? (updatingPreview ? "최종 생성 중" : "저장 중") : "저장"}</button></div></section></div>}
  </>;
}

export { GifMaker };
