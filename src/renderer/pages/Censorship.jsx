import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, Copy, Eraser, Home as HomeIcon, LayoutGrid, Minus, Paintbrush, RectangleHorizontal, RectangleVertical, RefreshCcw, RotateCcw, Settings as SettingsIcon, Square, X } from "lucide-react";
import { matchesProjectPath, savedCensorShortcuts, savedCensorshipSettings, matchesInputShortcut, registerCensorEditFlusher, flushCensorEdits } from "../shared.js";

const MAX_UNDO_HISTORY = 20;

function ManualCensorEditor({ asset, project, editorSettings, onEditorSettingsChange, onClose, onSaved, onSaveError, onReset, onMarkManual, embedded = false, shortcuts = savedCensorShortcuts() }) {
  const canvasRef = useRef(null);
  const { mode, tool, shape, color, size, hardness, opacity } = editorSettings;
  const updateEditorSetting = (key, value) => onEditorSettingsChange((current) => ({ ...current, [key]: typeof value === "function" ? value(current[key]) : value }));
  const setTool = (value) => updateEditorSetting("tool", value);
  const setMode = (value) => updateEditorSetting("mode", value);
  const setShape = (value) => updateEditorSetting("shape", value);
  const setColor = (value) => updateEditorSetting("color", value);
  const setSize = (value) => updateEditorSetting("size", value);
  const setHardness = (value) => updateEditorSetting("hardness", value);
  const setOpacity = (value) => updateEditorSetting("opacity", value);
  const [zoom, setZoom] = useState(100);
  const [fittedSize, setFittedSize] = useState({ width: 0, height: 0 });
  const [drawing, setDrawing] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [loadStatus, setLoadStatus] = useState("loading");
  const [loadMessage, setLoadMessage] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const [cursor, setCursor] = useState({ visible: false, x: 0, y: 0, size: 0 });
  const history = useRef([]);
  const strokeEffect = useRef(null);
  const strokeStamp = useRef(null);
  const strokeMode = useRef("brush");
  const originalImage = useRef(null);
  const lastPoint = useRef(null);
  const lastAnchor = useRef(null);
  const panState = useRef(null);
  const saveState = useRef({ timer: null, inFlight: false, activePromise: null, pending: null });

  useEffect(() => {
    let active = true;
    const loadImage = (source) => new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("이미지 파일이 손상되었거나 지원하지 않는 형식입니다."));
      image.src = source;
    });
    setLoadStatus("loading");
    setLoadMessage("");
    (async () => {
      try {
        const [source, originalSource] = await Promise.all([window.aaa.assets.url(asset.id), window.aaa.assets.url(asset.id, true)]);
        const original = await loadImage(originalSource);
        let image;
        let fallback = false;
        try { image = await loadImage(source); }
        catch { image = original; fallback = true; }
        if (!active || !canvasRef.current) return;
        const canvas = canvasRef.current;
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        const copy = document.createElement("canvas");
        copy.width = original.naturalWidth;
        copy.height = original.naturalHeight;
        copy.getContext("2d").drawImage(original, 0, 0);
        originalImage.current = copy;
        const area = canvas.closest(".editor-canvas");
        const scale = Math.min((area.clientWidth - 36) / image.naturalWidth, (area.clientHeight - 36) / image.naturalHeight, 1);
        setFittedSize({ width: image.naturalWidth * scale, height: image.naturalHeight * scale });
        setLoadStatus("ready");
        if (fallback) setLoadMessage("검열본을 불러오지 못해 원본 이미지를 표시합니다.");
      } catch (error) {
        if (!active) return;
        setLoadStatus("error");
        setLoadMessage(error.message || "이미지를 불러오지 못했습니다.");
      }
    })();
    return () => { active = false; };
  }, [asset.id, loadVersion]);
  useEffect(() => () => {
    const state = saveState.current;
    if (state.timer) clearTimeout(state.timer);
    if (state.pending) {
      const pending = state.pending;
      state.pending = null;
      window.aaa.assets.saveCensored(asset.id, pending).catch((error) => onSaveError?.(`검열 이미지를 저장하지 못했습니다: ${error.message}`));
    }
  }, [asset.id]);
  useEffect(() => {
    const flush = () => flushForClose();
    return registerCensorEditFlusher(flush);
  }, [asset.id]);
  useEffect(() => { const listener = (event) => { if (matchesInputShortcut(event, shortcuts.undo)) { event.preventDefault(); undo(); } else adjustByShortcut(event); }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); });
  useEffect(() => { const area = canvasRef.current?.closest(".editor-canvas"); if (!area) return; const listener = (event) => adjustByWheel(event); area.addEventListener("wheel", listener, { passive: false }); return () => area.removeEventListener("wheel", listener); });
  useEffect(() => {
    const area = canvasRef.current?.closest(".editor-canvas"); if (!area) return;
    const down = (event) => { if (!event.altKey) return; event.preventDefault(); event.stopPropagation(); panState.current = { x: event.clientX, y: event.clientY, left: area.scrollLeft, top: area.scrollTop, pointerId: event.pointerId }; area.classList.add("panning"); area.setPointerCapture(event.pointerId); };
    const move = (event) => { const pan = panState.current; if (!pan) return; event.preventDefault(); area.scrollLeft = pan.left - (event.clientX - pan.x); area.scrollTop = pan.top - (event.clientY - pan.y); };
    const up = (event) => { if (!panState.current) return; panState.current = null; area.classList.remove("panning"); if (area.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId); };
    area.addEventListener("pointerdown", down, true); area.addEventListener("pointermove", move, true); area.addEventListener("pointerup", up, true); area.addEventListener("pointercancel", up, true);
    return () => { area.removeEventListener("pointerdown", down, true); area.removeEventListener("pointermove", move, true); area.removeEventListener("pointerup", up, true); area.removeEventListener("pointercancel", up, true); };
  });
  useEffect(() => { const canvas = canvasRef.current; if (!canvas || !fittedSize.width) return; canvas.style.width = `${fittedSize.width * zoom / 100}px`; canvas.style.height = `${fittedSize.height * zoom / 100}px`; }, [zoom, fittedSize]);
  useEffect(() => { canvasRef.current?.closest(".censor-editor")?.querySelector('input[type="range"]')?.setAttribute("min", "1"); }, []);

  function point(event) { const canvas = canvasRef.current; const box = canvas.getBoundingClientRect(); return { x: (event.clientX - box.left) * canvas.width / box.width, y: (event.clientY - box.top) * canvas.height / box.height }; }
  function updateCursor(event) {
    const canvas = canvasRef.current; const box = canvas.getBoundingClientRect();
    setCursor({ visible: true, x: event.clientX - box.left, y: event.clientY - box.top, size: size * box.width / canvas.width });
  }
  function brushStamp() {
    const stamp = document.createElement("canvas"); const extent = Math.max(2, Math.ceil(size)); stamp.width = extent; stamp.height = extent; const context = stamp.getContext("2d"); const radius = extent / 2; const hard = Math.min(.999, hardness / 100);
    context.fillStyle = color; context.fillRect(0, 0, extent, extent); context.globalCompositeOperation = "destination-in";
    if (shape === "circle") { const gradient = context.createRadialGradient(radius, radius, radius * hard, radius, radius, radius); gradient.addColorStop(0, `rgba(0,0,0,${opacity / 100})`); gradient.addColorStop(1, "rgba(0,0,0,0)"); context.fillStyle = gradient; context.fillRect(0, 0, extent, extent); }
    else { const mask = document.createElement("canvas"); mask.width = extent; mask.height = extent; const maskContext = mask.getContext("2d"); const image = maskContext.createImageData(extent, extent); for (let y = 0; y < extent; y += 1) for (let x = 0; x < extent; x += 1) { const offset = (y * extent + x) * 4; const distance = Math.max(Math.abs(x + .5 - radius), Math.abs(y + .5 - radius)) / radius; const alpha = distance <= hard ? opacity / 100 : Math.max(0, 1 - (distance - hard) / Math.max(.001, 1 - hard)) * opacity / 100; image.data[offset] = 255; image.data[offset + 1] = 255; image.data[offset + 2] = 255; image.data[offset + 3] = Math.round(alpha * 255); } maskContext.putImageData(image, 0, 0); context.drawImage(mask, 0, 0); }
    return stamp;
  }
  function dab(x, y) {
    const canvas = canvasRef.current; const context = canvas.getContext("2d"); const radius = size / 2; const stamp = strokeStamp.current || brushStamp();
    if (strokeMode.current === "brush" && tool === "solid") context.drawImage(stamp, x - radius, y - radius, size, size);
    else if (strokeEffect.current) { const patch = document.createElement("canvas"); patch.width = stamp.width; patch.height = stamp.height; const output = patch.getContext("2d"); output.drawImage(strokeEffect.current, x - radius, y - radius, size, size, 0, 0, stamp.width, stamp.height); output.globalCompositeOperation = "destination-in"; output.drawImage(stamp, 0, 0); context.drawImage(patch, x - radius, y - radius, size, size); }
  }
  function applyBrush(event, force = false) {
    if (!drawing && !force) return;
    updateCursor(event);
    const current = point(event); const previous = lastPoint.current || current; const distance = Math.hypot(current.x - previous.x, current.y - previous.y); const spacing = Math.max(1, size * .12); const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let index = 1; index <= steps; index += 1) dab(previous.x + (current.x - previous.x) * index / steps, previous.y + (current.y - previous.y) * index / steps);
    lastPoint.current = current;
  }
  function start(event) {
    if (event.altKey) return;
    const canvas = canvasRef.current;
    history.current.push(canvas.toDataURL());
    if (history.current.length > MAX_UNDO_HISTORY) history.current.shift();
    setDrawing(true);
    canvas.setPointerCapture(event.pointerId);
    strokeMode.current = event.button === 2 ? (mode === "brush" ? "eraser" : "brush") : mode;
    strokeStamp.current = brushStamp();
    if (strokeMode.current === "eraser") strokeEffect.current = originalImage.current;
    else if (tool === "blur" || tool === "mosaic") {
      const effect = document.createElement("canvas"); effect.width = canvas.width; effect.height = canvas.height; const output = effect.getContext("2d");
      if (tool === "blur") { output.filter = `blur(${Math.max(2, (100 - hardness) / 5)}px)`; output.drawImage(canvas, 0, 0); }
      else { const block = Math.max(3, Math.round(size / 10)); const tiny = document.createElement("canvas"); tiny.width = Math.max(1, Math.ceil(canvas.width / block)); tiny.height = Math.max(1, Math.ceil(canvas.height / block)); tiny.getContext("2d").drawImage(canvas, 0, 0, tiny.width, tiny.height); output.imageSmoothingEnabled = false; output.drawImage(tiny, 0, 0, canvas.width, canvas.height); }
      strokeEffect.current = effect;
    } else strokeEffect.current = null;
    const current = point(event);
    const lineModifierActive = shortcuts.lineModifier !== "disabled" && event[`${shortcuts.lineModifier}Key`];
    if (lineModifierActive && lastAnchor.current) { const distance = Math.hypot(current.x - lastAnchor.current.x, current.y - lastAnchor.current.y); const spacing = Math.max(1, size * .12); const steps = Math.max(1, Math.ceil(distance / spacing)); for (let index = 1; index <= steps; index += 1) dab(lastAnchor.current.x + (current.x - lastAnchor.current.x) * index / steps, lastAnchor.current.y + (current.y - lastAnchor.current.y) * index / steps); }
    else dab(current.x, current.y);
    lastPoint.current = current;
    lastAnchor.current = current;
  }
  function persist() {
    const state = saveState.current;
    state.pending = canvasRef.current.toDataURL("image/png");
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(commitPersist, 1000);
    setSaveStatus("저장 대기");
  }
  async function commitPersist() {
    const state = saveState.current;
    state.timer = null;
    if (state.inFlight || !state.pending) return;
    const dataUrl = state.pending;
    state.pending = null;
    state.inFlight = true;
    setSaveStatus("저장 중");
    let failed = false;
    try {
      const savePromise = window.aaa.assets.saveCensored(asset.id, dataUrl);
      state.activePromise = savePromise;
      await savePromise;
      onSaved?.();
      setSaveStatus(state.pending ? "저장 대기" : "저장됨");
    } catch (error) {
      failed = true;
      if (!state.pending) state.pending = dataUrl;
      setSaveStatus("저장 실패");
      onSaveError?.(`검열 이미지를 저장하지 못했습니다: ${error.message}`);
    } finally {
      state.activePromise = null;
      state.inFlight = false;
      if (state.pending && !failed) state.timer = setTimeout(commitPersist, 1000);
    }
  }
  async function flushForClose() {
    const state = saveState.current;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (state.pending) {
      const dataUrl = state.pending;
      state.pending = null;
      setSaveStatus("저장 중");
      try { await window.aaa.assets.saveCensored(asset.id, dataUrl); }
      catch (error) { state.pending = dataUrl; setSaveStatus("저장 실패"); throw error; }
      onSaved?.();
      setSaveStatus("저장됨");
      return;
    }
    if (state.activePromise) await state.activePromise;
  }
  function retrySave() { if (!saveState.current.inFlight && saveState.current.pending) commitPersist(); }
  async function resetAsset() {
    const state = saveState.current;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.pending = null;
    setSaveStatus("");
    await onReset?.();
    const source = await window.aaa.assets.url(asset.id, true);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      history.current = [];
      lastAnchor.current = null;
      lastPoint.current = null;
    };
    image.src = source;
  }
  async function markManual() {
    const state = saveState.current;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (state.pending) {
      const dataUrl = state.pending;
      state.pending = null;
      setSaveStatus("저장 중");
      try { await window.aaa.assets.saveCensored(asset.id, dataUrl); setSaveStatus("저장됨"); }
      catch (error) { state.pending = dataUrl; setSaveStatus("저장 실패"); onSaveError?.(`검열 이미지를 저장하지 못했습니다: ${error.message}`); return; }
    }
    await onMarkManual?.();
  }
  function endStroke() { lastAnchor.current = lastPoint.current; setDrawing(false); strokeEffect.current = null; strokeStamp.current = null; lastPoint.current = null; persist(); }
  function adjustByWheel(event) { adjustByShortcut(event); }
  function adjustByShortcut(event) {
    const actions = [
      ["brushIncrease", () => setSize((value) => Math.min(240, value + 4))], ["brushDecrease", () => setSize((value) => Math.max(1, value - 4))],
      ["hardnessIncrease", () => setHardness((value) => Math.min(100, value + 5))], ["hardnessDecrease", () => setHardness((value) => Math.max(0, value - 5))],
      ["opacityIncrease", () => setOpacity((value) => Math.min(100, value + 5))], ["opacityDecrease", () => setOpacity((value) => Math.max(0, value - 5))],
      ["zoomIncrease", () => setZoom((value) => Math.min(800, value + 25))], ["zoomDecrease", () => setZoom((value) => Math.max(80, value - 25))]
    ];
    const matched = actions.find(([key]) => matchesInputShortcut(event, shortcuts[key]));
    if (!matched) return false;
    event.preventDefault(); matched[1](); return true;
  }
  function undo() { const source = history.current.pop(); if (!source) return; const image = new Image(); image.onload = () => { const canvas = canvasRef.current; canvas.getContext("2d").drawImage(image, 0, 0); persist(); }; image.src = source; }

  const editor = <section className={`censor-editor ${embedded ? "embedded" : ""}`}><header><div><h2>수동 검열</h2><p>{asset.relativePath}</p></div>{!embedded && <button className="modal-close" onClick={onClose}>×</button>}</header><div className="editor-toolbar"><button className={`outline-button editor-icon-button brush-mode-toggle ${mode}`} aria-label={mode === "brush" ? "브러쉬" : "지우개"} data-tooltip={mode === "brush" ? "브러쉬" : "지우개"} onClick={() => setMode(mode === "brush" ? "eraser" : "brush")}>{mode === "brush" ? <Paintbrush size={17} /> : <Eraser size={17} />}</button><select value={tool} onChange={(event) => setTool(event.target.value)}><option value="solid">단색</option><option value="blur">블러</option><option value="mosaic">모자이크</option></select><button className="outline-button editor-icon-button" aria-label={shape === "circle" ? "원형" : "사각형"} data-tooltip={shape === "circle" ? "원형" : "사각형"} onClick={() => setShape(shape === "circle" ? "square" : "circle")}>{shape === "circle" ? <Circle size={17} /> : <Square size={17} />}</button><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /><label>크기<input type="range" min="8" max="240" value={size} onChange={(event) => setSize(Number(event.target.value))} /><output>{size}</output></label><label>경도<input type="range" min="0" max="100" value={hardness} onChange={(event) => setHardness(Number(event.target.value))} /><output>{hardness}</output></label><label>불투명도<input type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /><output>{opacity}</output></label><button className="outline-button editor-icon-button" aria-label="되돌리기" data-tooltip="되돌리기" onClick={undo}><RotateCcw size={17} /></button><button className="outline-button editor-icon-button" aria-label="초기화" data-tooltip="초기화" onClick={resetAsset}><RefreshCcw size={17} /></button><button className="outline-button editor-icon-button" aria-label="수동완료" data-tooltip="수동완료" onClick={markManual}><Check size={18} /></button>{saveStatus && <span className={`editor-save-status ${saveStatus === "저장 실패" ? "error" : ""}`}>{saveStatus}</span>}{saveStatus === "저장 실패" && <button className="outline-button censor-save-retry" onClick={retrySave}>다시 시도</button>}</div><div className="editor-canvas">{loadStatus !== "ready" && <div className={`censor-load-state ${loadStatus}`}><strong>{loadStatus === "loading" ? "이미지 불러오는 중…" : "이미지를 불러오지 못했습니다."}</strong>{loadMessage && <p>{loadMessage}</p>}{loadStatus === "error" && <button className="outline-button" onClick={() => setLoadVersion((value) => value + 1)}>다시 시도</button>}</div>}{loadStatus === "ready" && loadMessage && <div className="censor-load-warning">{loadMessage}<button className="text-button" onClick={() => setLoadVersion((value) => value + 1)}>다시 시도</button></div>}<div className="canvas-stage" style={{ visibility: loadStatus === "ready" ? "visible" : "hidden" }}><canvas ref={canvasRef} onContextMenu={(event) => event.preventDefault()} onPointerDown={start} onPointerMove={(event) => { updateCursor(event); applyBrush(event); }} onPointerEnter={updateCursor} onPointerLeave={() => setCursor({ ...cursor, visible: false })} onPointerUp={endStroke} onPointerCancel={endStroke} /><span className={`brush-preview ${shape}`} style={{ display: cursor.visible ? "block" : "none", width: cursor.size, height: cursor.size, left: cursor.x, top: cursor.y, background: mode === "brush" && tool === "solid" ? `${color}${Math.round(opacity * 2.55).toString(16).padStart(2, "0")}` : "transparent" }} /></div></div></section>;
  return embedded ? editor : <div className="editor-backdrop">{editor}</div>;
}

function Censorship({ project }) {
  const [assets, setAssets] = useState([]); const [filter, setFilter] = useState("all"); const [selectedId, setSelectedId] = useState("");
  const [aiStatus, setAiStatus] = useState("");
  const [aiModal, setAiModal] = useState(false);
  const [aiScope, setAiScope] = useState("unreviewed");
  const [aiSelectedIds, setAiSelectedIds] = useState([]);
  const [aiSettings, setAiSettings] = useState(() => savedCensorshipSettings());
  const [aiRunning, setAiRunning] = useState(false);
  const [aiCancelling, setAiCancelling] = useState(false);
  const [aiProgress, setAiProgress] = useState(null);
  const [aiError, setAiError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [aiResult, setAiResult] = useState(null);
  const shortcuts = savedCensorShortcuts();
  const censorshipSettings = savedCensorshipSettings();
  const [editorSettings, setEditorSettings] = useState(() => ({ mode: "brush", tool: censorshipSettings.method, shape: censorshipSettings.shape, color: censorshipSettings.color, size: censorshipSettings.size, hardness: censorshipSettings.hardness, opacity: censorshipSettings.opacity }));
  const load = () => window.aaa.assets.list(project.id).then(setAssets);
  useEffect(() => { load(); }, [project.id]);
  const eligibleAssets = useMemo(() => {
    if (!project.tags.length || !project.pathTemplate) return [];
    return assets.filter((asset) => matchesProjectPath(project, asset.relativePath));
  }, [assets, project.tags, project.pathTemplate]);
  const filtered = filter === "all" ? eligibleAssets : eligibleAssets.filter((asset) => asset.reviewStatus === filter);
  const selectedFromAll = eligibleAssets.find((asset) => asset.id === selectedId);
  const visible = selectedFromAll && !filtered.some((asset) => asset.id === selectedFromAll.id) ? [selectedFromAll, ...filtered] : filtered;
  const selected = visible.find((asset) => asset.id === selectedId) || visible[0];
  async function selectAsset(id) {
    if (!id || id === selected?.id) return;
    try { await flushCensorEdits(); setEditorError(""); setSelectedId(id); }
    catch (error) { setEditorError(`현재 이미지 저장에 실패해 이동하지 않았습니다: ${error.message}`); }
  }
  async function changeFilter(value) {
    try { await flushCensorEdits(); setEditorError(""); setFilter(value); setSelectedId(""); }
    catch (error) { setEditorError(`현재 이미지 저장에 실패해 필터를 변경하지 않았습니다: ${error.message}`); }
  }
  useEffect(() => { if (selected?.id && selected.id !== selectedId) setSelectedId(selected.id); }, [selected?.id, selectedId]);
  useEffect(() => { const listener = (event) => { if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) || !visible.length) return; const index = Math.max(0, visible.findIndex((asset) => asset.id === selected?.id)); if (matchesInputShortcut(event, shortcuts.previous)) { event.preventDefault(); selectAsset(visible[Math.max(0, index - 1)].id); } else if (matchesInputShortcut(event, shortcuts.next)) { event.preventDefault(); selectAsset(visible[Math.min(visible.length - 1, index + 1)].id); } }; window.addEventListener("keydown", listener); window.addEventListener("wheel", listener, { passive: false }); return () => { window.removeEventListener("keydown", listener); window.removeEventListener("wheel", listener); }; }, [visible, selected?.id, shortcuts]);
  useEffect(() => window.aaa.assets.onAiProgress(setAiProgress), []);
  useEffect(() => {
    if (!aiRunning) return undefined;
    const block = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener("keydown", block, true);
    window.addEventListener("wheel", block, { capture: true, passive: false });
    return () => { window.removeEventListener("keydown", block, true); window.removeEventListener("wheel", block, true); };
  }, [aiRunning]);
  const labels = { unreviewed: "대기", auto: "자동완료", manual: "수동완료", failed: "실패" };
  const aiTargets = aiScope === "all" ? eligibleAssets : aiScope === "manual" ? eligibleAssets.filter((asset) => aiSelectedIds.includes(asset.id)) : eligibleAssets.filter((asset) => asset.reviewStatus === "unreviewed");
  const progressPercent = !aiProgress ? 0 : aiProgress.stage === "loading" ? 5 : aiProgress.stage === "detecting" ? 10 + Math.round(55 * aiProgress.completed / Math.max(1, aiProgress.total)) : 65 + Math.round(35 * aiProgress.completed / Math.max(1, aiProgress.total));

  function openAiModal() {
    setAiSettings(savedCensorshipSettings());
    setAiScope("unreviewed");
    setAiSelectedIds([]);
    setAiError("");
    setAiResult(null);
    setAiProgress(null);
    setAiModal(true);
  }

  async function startAiCensorship() {
    if (!aiTargets.length) { setAiError("작업할 이미지를 선택해 주세요."); return; }
    if (!aiSettings.modelPath?.toLowerCase().endsWith(".pt")) { setAiError("설정에서 .pt 모델 파일을 지정해 주세요."); return; }
    setAiError("");
    setAiResult(null);
    setAiRunning(true);
    setAiProgress({ stage: "loading", completed: 0, total: aiTargets.length, message: "AI 모델 불러오는 중" });
    try {
      const result = await window.aaa.assets.aiCensor({ projectId: project.id, assetIds: aiTargets.map((asset) => asset.id), settings: { ...aiSettings, targets: [] } });
      setAiResult(result);
      setAiStatus(`AI 검열 완료 · 성공 ${result.succeeded} · 실패 ${result.failed}`);
      await load();
    } catch (reason) { setAiError(reason.message); }
    finally { setAiCancelling(false); setAiRunning(false); }
  }

  async function cancelAiCensorship() {
    if (!aiRunning || aiCancelling) return;
    setAiCancelling(true);
    setAiProgress((current) => ({ ...(current || {}), message: "AI 검열 작업 취소 중" }));
    try { await window.aaa.assets.cancelAi(); }
    catch (reason) { setAiError(reason.message); setAiCancelling(false); }
  }

  return <><div className="censorship-workspace"><aside className="censorship-sidebar"><div><button className="primary-button full" onClick={openAiModal}>AI 검열</button>{aiStatus && <p className="ai-status">{aiStatus}</p>}{editorError && <p className="error">{editorError}</p>}</div><select value={filter} onChange={(event) => changeFilter(event.target.value)}><option value="all">전체</option><option value="unreviewed">대기</option><option value="auto">자동완료</option><option value="manual">수동완료</option><option value="failed">실패</option></select><div className="censorship-file-list">{visible.map((asset) => <button className={selected?.id === asset.id ? "active" : ""} key={asset.id} onClick={() => selectAsset(asset.id)}><span className={`review-dot ${asset.reviewStatus}`} /><span>{asset.relativePath}</span><small>{labels[asset.reviewStatus]}</small></button>)}</div></aside><main className="censorship-main">{selected ? <ManualCensorEditor key={selected.id} asset={selected} project={project} editorSettings={editorSettings} onEditorSettingsChange={setEditorSettings} embedded onSaved={load} onSaveError={setEditorError} onReset={async () => { await window.aaa.assets.setReview(selected.id, "unreviewed"); await load(); }} onMarkManual={async () => { await window.aaa.assets.setReview(selected.id, "manual"); await load(); }} /> : <div className="empty-state">이미지가 없습니다.</div>}</main></div>
    {aiModal && <div className={`modal-backdrop ai-censorship-backdrop ${aiRunning ? "running" : ""}`}><section className="modal ai-censorship-modal">
      <div className="modal-heading"><h2>AI 검열 작업</h2>{!aiRunning && <button className="modal-close" onClick={() => setAiModal(false)}>×</button>}</div>
      {aiRunning ? <div className="ai-job-progress"><strong>{aiProgress?.message || "작업 준비 중"}</strong><div className="progress-track"><div className="progress-fill censorship" style={{ width: `${progressPercent}%` }} /></div><span>{progressPercent}%</span><p>{aiCancelling ? "실행 중인 AI 프로세스를 종료하고 있습니다." : "작업이 끝날 때까지 다른 기능을 사용할 수 없습니다."}</p><button className="danger-button" disabled={aiCancelling} onClick={cancelAiCensorship}>{aiCancelling ? "취소 중" : "작업 취소"}</button></div> : <>
        <section className="ai-job-section"><h3>작업할 파일</h3><div className="ai-scope-options">{[["unreviewed", "대기 중", eligibleAssets.filter((asset) => asset.reviewStatus === "unreviewed").length], ["all", "전체", eligibleAssets.length], ["manual", "수동 선택", aiSelectedIds.length]].map(([value, text, count]) => <button className={aiScope === value ? "active" : ""} key={value} onClick={() => setAiScope(value)}><span>{text}</span><strong>{count}</strong></button>)}</div>{aiScope === "manual" && <div className="ai-file-picker">{eligibleAssets.map((asset) => <label key={asset.id}><input type="checkbox" checked={aiSelectedIds.includes(asset.id)} onChange={(event) => setAiSelectedIds((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} /><span>{asset.relativePath}</span><small>{labels[asset.reviewStatus]}</small></label>)}</div>}<p className="ai-selection-count">선택된 이미지 {aiTargets.length}개</p></section>
        <section className="ai-job-section"><h3>검열 설정</h3><div className="ai-settings-grid"><label className="wide">모델 파일<div className="directory-field"><input readOnly value={aiSettings.modelPath || ""} /><button className="outline-button" onClick={async () => { const modelPath = await window.aaa.chooseModel(); if (modelPath) setAiSettings({ ...aiSettings, modelPath }); }}>찾아보기</button></div></label><p className="wide ai-model-note">모델이 탐지한 모든 클래스의 영역 마스크를 검열합니다.</p><label>방식<select value={aiSettings.method} onChange={(event) => setAiSettings({ ...aiSettings, method: event.target.value })}><option value="solid">단색</option><option value="blur">블러</option><option value="mosaic">모자이크</option></select></label><label>입력 해상도<input type="number" min="320" max="4096" step="32" value={aiSettings.imageSize || 640} onChange={(event) => setAiSettings({ ...aiSettings, imageSize: Math.max(320, Math.min(4096, Number(event.target.value) || 640)) })} /></label><label>탐지 신뢰도<div className="ai-range-field"><input type="range" min="1" max="100" value={aiSettings.confidence || 50} onChange={(event) => setAiSettings({ ...aiSettings, confidence: Number(event.target.value) })} /><output>{aiSettings.confidence || 50}%</output></div></label><label>마스크 확장<div className="ai-range-field"><input type="range" min="0" max="100" value={aiSettings.dilation || 0} onChange={(event) => setAiSettings({ ...aiSettings, dilation: Number(event.target.value) })} /><output>{aiSettings.dilation || 0}px</output></div></label><label>경도<div className="ai-range-field"><input type="range" min="0" max="100" value={aiSettings.hardness} onChange={(event) => setAiSettings({ ...aiSettings, hardness: Number(event.target.value) })} /><output>{aiSettings.hardness}</output></div></label><label>불투명도<div className="ai-range-field"><input type="range" min="0" max="100" value={aiSettings.opacity} onChange={(event) => setAiSettings({ ...aiSettings, opacity: Number(event.target.value) })} /><output>{aiSettings.opacity}</output></div></label>{aiSettings.method === "solid" && <label>색상<input type="color" value={aiSettings.color} onChange={(event) => setAiSettings({ ...aiSettings, color: event.target.value })} /></label>}</div></section>
        {aiResult && <p className="success">완료 · 성공 {aiResult.succeeded}개 · 실패 {aiResult.failed}개</p>}{aiError && <p className="error">{aiError}</p>}
        <div className="modal-actions"><button className="text-button" onClick={() => setAiModal(false)}>닫기</button><button className="primary-button" disabled={!aiTargets.length} onClick={startAiCensorship}>작업 시작</button></div>
      </>}
    </section></div>}
  </>;
}

export { Censorship };
