import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Images, Palette, Play } from "lucide-react";
import { ProjectTitlebarNav } from "../components/Shell";
import { ModelTargetsField } from "../components/ModelTargetsField";
import { DEFAULT_CENSORSHIP, EXTENSIONS, ORIGINAL_EXTENSION, savedCensorshipSettings } from "../shared";

const FILE_LIST_LIMIT = 200;

function formattedFileSize(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function progressPercent(progress) {
  if (!progress) return 0;
  if (progress.stage === "loading") return 5;
  const ratio = Math.max(0, Math.min(1, Number(progress.completed) / Math.max(1, Number(progress.total))));
  if (progress.stage === "detecting") return 10 + Math.round(55 * ratio);
  return 65 + Math.round(35 * ratio);
}

function StandaloneAiCensor({ onBack }) {
  const [files, setFiles] = useState([]);
  const [sourceLabel, setSourceLabel] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [outputExtension, setOutputExtension] = useState(ORIGINAL_EXTENSION);
  const [conflictPolicy, setConflictPolicy] = useState("rename");
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_CENSORSHIP, ...savedCensorshipSettings() }));
  const [runtimeAvailable, setRuntimeAvailable] = useState(false);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    window.aaa.aiRuntime.status().then((status) => { if (active) setRuntimeAvailable(Boolean(status?.available)); }).catch(() => { if (active) setRuntimeAvailable(false); }).finally(() => { if (active) setRuntimeLoading(false); });
    const unsubscribe = window.aaa.standaloneAi.onProgress((nextProgress) => { if (active) setProgress(nextProgress); });
    return () => { active = false; unsubscribe(); };
  }, []);

  const failedResults = useMemo(() => result?.details?.filter((item) => item.status === "failed") || [], [result]);
  const percent = progressPercent(progress);

  const applySelection = (selection) => {
    if (!selection) return;
    setFiles(selection.files || []);
    setSourceLabel(selection.sourceLabel || "");
    setResult(null);
    setProgress(null);
    setError(selection.files?.length ? "" : "선택한 위치에 지원하는 이미지가 없습니다.");
  };

  const chooseFiles = async () => {
    try { applySelection(await window.aaa.standaloneAi.chooseFiles()); }
    catch (reason) { setError(reason.message); }
  };

  const chooseFolder = async () => {
    try { applySelection(await window.aaa.standaloneAi.chooseFolder()); }
    catch (reason) { setError(reason.message); }
  };

  const chooseOutput = async () => {
    const selected = await window.aaa.chooseDirectory();
    if (selected) { setOutputPath(selected); setResult(null); setError(""); }
  };

  const start = async () => {
    if (!files.length) { setError("작업할 이미지를 선택해 주세요."); return; }
    if (!outputPath) { setError("결과를 저장할 폴더를 선택해 주세요."); return; }
    if (!settings.targets.length) { setError("검열 대상을 하나 이상 선택해 주세요."); return; }
    if (!settings.modelPath?.toLowerCase().endsWith(".pt")) { setError("사용할 .pt 모델 파일을 선택해 주세요."); return; }
    setRunning(true);
    setCancelling(false);
    setResult(null);
    setError("");
    setProgress({ stage: "loading", completed: 0, total: files.length, message: "AI 모델 불러오는 중" });
    try {
      const completed = await window.aaa.standaloneAi.run({ files, outputPath, outputExtension, conflictPolicy, settings });
      setResult(completed);
      setProgress({ stage: "saving", completed: completed.total, total: completed.total, message: "작업 완료" });
    } catch (reason) {
      setError(reason.message);
    } finally {
      setRunning(false);
      setCancelling(false);
    }
  };

  const cancel = async () => {
    if (!running || cancelling) return;
    setCancelling(true);
    setProgress((current) => ({ ...(current || {}), message: "AI 검열 작업 취소 중" }));
    try { await window.aaa.standaloneAi.cancel(); }
    catch (reason) { setError(reason.message); setCancelling(false); }
  };

  return <>
    <ProjectTitlebarNav project={null} tab="standalone-ai" onHome={() => { if (!running) onBack(); }} contextLabel="에셋 AI 검열" />
    <main className="page standalone-ai-page">
      <div className="standalone-ai-content">
        <section className="standalone-ai-card">
          <header><h2>작업 이미지</h2><div className="standalone-ai-card-actions"><button className="outline-button button-with-icon" disabled={running} onClick={chooseFiles}><Images size={16} />파일 선택</button><button className="outline-button button-with-icon" disabled={running} onClick={chooseFolder}><FolderOpen size={16} />폴더 선택</button></div></header>
          <div className="directory-field"><input readOnly value={sourceLabel} placeholder="이미지 파일 또는 폴더를 선택해 주세요" /><span className="standalone-ai-count">{files.length}개</span></div>
          {files.length > 0 && <div className="standalone-ai-file-list">{files.slice(0, FILE_LIST_LIMIT).map((file) => <div key={file.sourcePath}><span title={file.relativePath}>{file.relativePath}</span><small>{formattedFileSize(file.fileSize)}</small></div>)}{files.length > FILE_LIST_LIMIT && <p>외 {files.length - FILE_LIST_LIMIT}개 파일</p>}</div>}
        </section>

        <section className="standalone-ai-card">
          <header><h2>결과 저장</h2></header>
          <div className="standalone-ai-output-grid">
            <label className="wide">출력 폴더<div className="directory-field"><input readOnly value={outputPath} placeholder="결과를 저장할 폴더를 선택해 주세요" /><button className="outline-button" disabled={running} onClick={chooseOutput}>찾아보기</button></div></label>
            <label>저장 형식<select value={outputExtension} disabled={running} onChange={(event) => setOutputExtension(event.target.value)}><option value={ORIGINAL_EXTENSION}>원본과 동일</option>{EXTENSIONS.map((extension) => <option value={extension} key={extension}>{extension.slice(1).toUpperCase()}</option>)}</select></label>
            <label>파일 이름 중복 처리<select value={conflictPolicy} disabled={running} onChange={(event) => setConflictPolicy(event.target.value)}><option value="rename">이름 바꾸기</option><option value="overwrite">덮어쓰기</option><option value="skip">건너뛰기</option></select></label>
          </div>
        </section>

        <section className="standalone-ai-card ai-job-section">
          <header><h2>AI 설정</h2><span className={runtimeAvailable ? "success standalone-ai-runtime-status" : "error standalone-ai-runtime-status"}>{runtimeLoading ? "AI 패키지 확인 중" : runtimeAvailable ? "AI 패키지 사용 가능" : "AI 패키지 설치 필요"}</span></header>
          <div className="ai-settings-grid">
            <label className="wide">모델 파일<div className="directory-field"><input readOnly value={settings.modelPath || ""} /><button className="outline-button" disabled={running} onClick={async () => { const modelPath = await window.aaa.chooseModel(); if (modelPath) setSettings({ ...settings, modelPath }); }}>찾아보기</button></div></label>
            <ModelTargetsField className="wide" disabled={running} modelPath={settings.modelPath} targets={settings.targets} onChange={(targets) => setSettings((current) => ({ ...current, targets }))} />
            <label>입력 해상도<input type="number" min="320" max="4096" step="32" disabled={running} value={settings.imageSize || 1024} onChange={(event) => setSettings({ ...settings, imageSize: Math.max(320, Math.min(4096, Number(event.target.value) || 1024)) })} /></label>
            <label>탐지 신뢰도<div className="number-with-unit"><input type="number" min="1" max="100" disabled={running} value={settings.confidence || 50} onChange={(event) => setSettings({ ...settings, confidence: Math.max(1, Math.min(100, Number(event.target.value) || 1)) })} /><span>%</span></div></label>
            <label>방식<select value={settings.method} disabled={running} onChange={(event) => setSettings({ ...settings, method: event.target.value })}><option value="solid">단색</option><option value="blur">블러</option><option value="mosaic">모자이크</option></select></label>
            <label onClick={(event) => { if (!(event.target as Element).closest(".brush-color-control")) event.preventDefault(); }}>색상<div className={`brush-color-control ${settings.method !== "solid" ? "disabled" : ""}`}><span aria-hidden="true"><Palette size={17} /></span><input type="color" aria-label="AI 검열 색상" disabled={running || settings.method !== "solid"} value={settings.color} onChange={(event) => setSettings({ ...settings, color: event.target.value })} /></div></label>
            <label>경도<div className="number-with-unit"><input type="number" min="0" max="100" disabled={running} value={settings.hardness} onChange={(event) => setSettings({ ...settings, hardness: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /><span>%</span></div></label>
            <label>불투명도<div className="number-with-unit"><input type="number" min="0" max="100" disabled={running} value={settings.opacity} onChange={(event) => setSettings({ ...settings, opacity: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /><span>%</span></div></label>
            <label>마스크 확장<div className="number-with-unit"><input type="number" min="0" max="100" disabled={running} value={settings.dilation || 0} onChange={(event) => setSettings({ ...settings, dilation: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /><span>px</span></div></label>
          </div>
        </section>

        {(running || progress) && <section className="standalone-ai-progress" aria-live="polite"><div><strong>{progress?.message || "작업 준비 중"}</strong><span>{percent}%</span></div><div className="progress-track"><div className="progress-fill censorship" style={{ width: `${percent}%` }} /></div></section>}
        {result && <section className={`standalone-ai-result ${result.failed ? "warning" : "success"}`}><div><strong>작업 완료</strong><span>전체 {result.total}개 · 성공 {result.succeeded}개 · 실패 {result.failed}개{result.skipped ? ` · 건너뜀 ${result.skipped}개` : ""}</span></div><button className="outline-button button-with-icon" onClick={() => window.aaa.openDirectory(result.outputPath)}><FolderOpen size={16} />결과 폴더 열기</button>{failedResults.length > 0 && <div className="standalone-ai-failures">{failedResults.slice(0, 20).map((item) => <p key={item.relativePath}><span>{item.relativePath}</span><small>{item.error}</small></p>)}</div>}</section>}
        {error && <p className="standalone-ai-error error">{error}</p>}
      </div>
      <footer className="standalone-ai-footer">{running ? <button className="danger-button" disabled={cancelling} onClick={cancel}>{cancelling ? "취소 중" : "작업 취소"}</button> : <button className="primary-button button-with-icon" disabled={!runtimeAvailable || !files.length || !outputPath} onClick={start}><Play size={16} />AI 검열 시작</button>}</footer>
    </main>
  </>;
}

export { StandaloneAiCensor };
