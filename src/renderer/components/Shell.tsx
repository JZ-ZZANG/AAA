import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, Copy, Eraser, Home as HomeIcon, LayoutGrid, Minus, Paintbrush, RectangleHorizontal, RectangleVertical, RotateCcw, Settings as SettingsIcon, Square, Trash2, X } from "lucide-react";
import { EXTENSIONS, ORIGINAL_EXTENSION, TRACKED_EXTENSIONS, shortcutFromEvent, wheelShortcutFromEvent } from "../shared";

function displayedShortcut(value) {
  return String(value || "").replaceAll("WheelUp", "Wheel↑").replaceAll("WheelDown", "Wheel↓");
}

function ShortcutInput({ value, onChange, allowWheel = false, ariaLabel = "단축키" }) {
  const [capturing, setCapturing] = useState(false);
  return <input
    className={capturing ? "shortcut-input-capturing" : ""}
    aria-label={ariaLabel}
    readOnly
    value={capturing ? "입력 대기..." : displayedShortcut(value)}
    onClick={(event) => { setCapturing(true); event.currentTarget.select(); }}
    onBlur={() => setCapturing(false)}
    onKeyDown={(event) => {
      if (!capturing) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { setCapturing(false); return; }
      const shortcut = shortcutFromEvent(event);
      if (!shortcut) return;
      onChange(shortcut);
      setCapturing(false);
    }}
    onWheel={allowWheel ? (event) => {
      if (!capturing) return;
      event.preventDefault();
      event.stopPropagation();
      onChange(wheelShortcutFromEvent(event));
      setCapturing(false);
    } : undefined}
  />;
}

function WindowControls() {
  const [isMaximized, setMaximized] = useState(false);
  useEffect(() => {
    window.aaa.window.isMaximized().then(setMaximized);
    return window.aaa.window.onMaximizedChanged(setMaximized);
  }, []);
  return <div className="window-controls"><button aria-label="최소화" title="최소화" onClick={() => window.aaa.window.minimize()}><Minus size={15} /></button><button aria-label={isMaximized ? "이전 크기로" : "최대화"} title={isMaximized ? "이전 크기로" : "최대화"} onClick={() => window.aaa.window.toggleMaximize()}>{isMaximized ? <Copy size={14} /> : <Square size={13} />}</button><button aria-label="닫기" title="닫기" className="close" onClick={() => window.aaa.window.close()}><X size={16} /></button></div>;
}

function Modal({ onClose, onCreated }) {
  const [mode, setMode] = useState(null);
  const [name, setName] = useState("");
  const [savePath, setSavePath] = useState("");
  const [censorshipExtension, setCensorshipExtension] = useState("none");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [archivePath, setArchivePath] = useState("");

  async function chooseDirectory() {
    const selected = await window.aaa.chooseDirectory();
    if (selected) setSavePath(selected);
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError("");
    try { onCreated(mode === "restore" ? await window.aaa.projects.restore({ archivePath, savePath }) : await window.aaa.projects.create({ name, savePath, censorshipEnabled: censorshipExtension !== "none", censorshipExtension: censorshipExtension === "none" ? ".png" : censorshipExtension })); }
    catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  }

  async function chooseArchive() {
    try { const selected = await window.aaa.projects.chooseArchive(); if (selected) { setArchivePath(selected.archivePath); setName(selected.name); setError(""); } }
    catch (reason) { setError(reason.message); }
  }

  if (!mode) return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal project-mode-modal"><div className="modal-heading"><h2>프로젝트 추가</h2><button className="modal-close" onClick={onClose}>×</button></div><div className="project-mode-options"><button className="outline-button" onClick={() => setMode("new")}><strong>새 프로젝트 생성</strong><span>새로운 빈 프로젝트를 만듭니다.</span></button><button className="outline-button" onClick={() => setMode("restore")}><strong>기존 프로젝트 복원</strong><span>프로젝트 ZIP 파일을 통해 프로젝트를 복원합니다.</span></button></div></section></div>;

  const restoreMode = mode === "restore";
  const locationField = <label>프로젝트 저장 위치<div className="directory-field"><input readOnly value={savePath} placeholder="저장할 폴더를 선택해 주세요" /><button type="button" className="outline-button" onClick={chooseDirectory}>위치 선택</button></div></label>;
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal"><div className="modal-heading"><h2>{restoreMode ? "기존 프로젝트 복원" : "새 프로젝트 생성"}</h2><button className="modal-close" onClick={onClose}>×</button></div><form className="project-create-form" onSubmit={submit}>{restoreMode ? <><label>프로젝트 압축파일<div className="directory-field"><input readOnly value={archivePath} placeholder="ZIP 파일을 선택해 주세요" /><button type="button" className="outline-button" onClick={chooseArchive}>파일 선택</button></div></label>{name && <label>복원할 프로젝트<input readOnly value={name} /></label>}{locationField}</> : <><label>프로젝트 이름<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>{locationField}<label>검열 에셋 저장 형식<select value={censorshipExtension} onChange={(event) => setCensorshipExtension(event.target.value)}><option value="none">검열 없음</option><option value={ORIGINAL_EXTENSION}>원본과 동일</option>{EXTENSIONS.map((extension) => <option value={extension} key={extension}>{extension.slice(1).toUpperCase()}</option>)}</select></label></>}{error && <p className="error">{error}</p>}<div className="modal-actions"><button type="button" className="text-button" onClick={() => { setMode(null); setError(""); }}>이전</button><button className="primary-button" disabled={saving || !name.trim() || !savePath.trim() || (restoreMode && !archivePath)}>{restoreMode ? "복원" : "생성"}</button></div></form></section></div>;
}

function DeleteConfirmModal({ title, target, busy = false, confirmDisabled = false, onClose, onConfirm, children = null }) {
  return <div className="modal-backdrop"><section className="modal delete-modal"><div className="modal-heading"><h2>{title}</h2><button className="modal-close icon-button" aria-label="닫기" disabled={busy} onClick={onClose}><X size={18} /></button></div><p><strong>{target}</strong><span>이 항목을 삭제하시겠습니까?</span><span>이 작업은 되돌릴 수 없습니다.</span></p>{children}<div className="modal-actions"><button className="text-button" disabled={busy} onClick={onClose}>취소</button><button className="danger-button" disabled={busy || confirmDisabled} onClick={onConfirm}>{busy ? "삭제 중…" : "삭제"}</button></div></section></div>;
}

function ProjectTitlebarNav({ project, tab, onTab = () => {}, onHome, homeActive = false, templateMode = false }: any) {
  return <><button className={`titlebar-home-button ${homeActive ? "active" : ""}`} aria-label="홈" onClick={onHome}><HomeIcon size={16} /><span>홈</span></button><nav className="project-titlebar-nav"><button disabled={templateMode || !project} className={tab === "settings" ? "active" : ""} onClick={() => onTab?.("settings")}>관리</button><button disabled={templateMode || !project} className={tab === "work" ? "active" : ""} onClick={() => onTab?.("work")}>작품</button><button disabled={!project} className={tab === "prompts" ? "active" : ""} onClick={() => onTab?.("prompts")}>프롬프트</button><button disabled={!project} className={tab === "lorebook" ? "active" : ""} onClick={() => onTab?.("lorebook")}>로어북</button><button disabled={!project} className={tab === "situation" ? "active" : ""} onClick={() => onTab?.("situation")}>시작 상황</button><button disabled={templateMode || !project} className={tab === "classification" ? "active" : ""} onClick={() => onTab?.("classification")}>에셋 분류</button><button disabled={templateMode || !project?.censorshipConfig?.enabled} className={tab === "censorship" ? "active" : ""} onClick={() => onTab?.("censorship")}>에셋 검열</button><button disabled={templateMode || !project} className={tab === "export" ? "active" : ""} onClick={() => onTab?.("export")}>내보내기</button></nav></>;
}

export { ShortcutInput, WindowControls, Modal, DeleteConfirmModal, ProjectTitlebarNav };
