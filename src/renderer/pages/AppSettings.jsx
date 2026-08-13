import { useState } from "react";
import { Circle, Download, ExternalLink, FolderArchive, Info, Keyboard, Palette, ShieldCheck, Square, Upload } from "lucide-react";
import { DEFAULT_SHORTCUTS, DEFAULT_CENSOR_SHORTCUTS, DEFAULT_CENSORSHIP } from "../shared.js";
import { ShortcutInput } from "../components/Shell.jsx";
import discordBlurpleIcon from "../assets/brands/Discord-Symbol-Blurple.svg";
import discordWhiteIcon from "../assets/brands/Discord-Symbol-White.svg";
import githubBlackIcon from "../assets/brands/GitHub_Invertocat_Black.svg";
import githubWhiteIcon from "../assets/brands/GitHub_Invertocat_White.svg";
import aaaLogoBlack from "../assets/app/AAA_logo_black.svg";
import aaaLogoWhite from "../assets/app/AAA_logo_white.svg";

const SETTINGS_TABS = [
  ["general", "일반", Palette],
  ["censorship", "검열 설정", ShieldCheck],
  ["shortcuts", "단축키", Keyboard],
  ["data", "데이터", FolderArchive],
  ["info", "정보", Info]
];
const GITHUB_URL = "https://github.com/JZ-ZZANG/AAA";

function updateStatusText(updateState) {
  if (updateState.status === "available") return "업데이트가 있습니다";
  if (updateState.status === "downloading") return `업데이트 다운로드 중 ${Math.round(updateState.percent || 0)}%`;
  if (updateState.status === "installing") return "업데이트 설치 중";
  if (updateState.status === "checking") return "업데이트 확인 중...";
  if (updateState.status === "error") return "업데이트를 확인하지 못했습니다";
  return "최신 버전입니다";
}

function mergeRestoredPreferences(current, incoming) {
  const source = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
  const next = { ...current };
  if (["system", "light", "dark"].includes(source.theme)) next.theme = source.theme;
  if ([3, 4, 5].includes(source.columns)) next.columns = source.columns;
  if (["square", "portrait", "landscape"].includes(source.ratio)) next.ratio = source.ratio;
  const restoreShortcuts = (defaults, saved, currentValues) => Object.fromEntries(Object.keys(defaults).map((key) => [key, typeof saved?.[key] === "string" ? saved[key] : currentValues?.[key] ?? defaults[key]]));
  next.shortcuts = restoreShortcuts(DEFAULT_SHORTCUTS, source.shortcuts, current.shortcuts);
  next.censorShortcuts = restoreShortcuts(DEFAULT_CENSOR_SHORTCUTS, source.censorShortcuts, current.censorShortcuts);
  const censorship = { ...current.censorship };
  for (const [key, defaultValue] of Object.entries(DEFAULT_CENSORSHIP)) {
    const savedValue = source.censorship?.[key];
    if (Array.isArray(defaultValue)) {
      if (Array.isArray(savedValue)) censorship[key] = savedValue.filter((value) => typeof value === "string");
    } else if (typeof defaultValue === "number") {
      if (Number.isFinite(savedValue)) censorship[key] = savedValue;
    } else if (typeof savedValue === "string") censorship[key] = savedValue;
  }
  next.censorship = censorship;
  return next;
}

function AppSettings({ preferences, onChange, onBack, updateState, onCheckUpdate, onInstallUpdate, onDataRestored }) {
  const [activeTab, setActiveTab] = useState("general");
  const [dataBusy, setDataBusy] = useState(false);
  const [dataStatus, setDataStatus] = useState(null);

  const backupData = async () => {
    setDataBusy(true);
    setDataStatus(null);
    try {
      const result = await window.aaa.data.backup(preferences);
      if (!result.canceled) setDataStatus({ type: "success", text: `백업 파일을 저장했습니다: ${result.filePath}` });
    } catch (error) {
      setDataStatus({ type: "error", text: error.message });
    } finally {
      setDataBusy(false);
    }
  };

  const restoreData = async () => {
    setDataBusy(true);
    setDataStatus(null);
    try {
      const result = await window.aaa.data.restore();
      if (result.canceled) return;
      const nextPreferences = mergeRestoredPreferences(preferences, result.preferences);
      localStorage.setItem("aaa-preferences", JSON.stringify(nextPreferences));
      onChange(nextPreferences);
      onDataRestored?.();
      setDataStatus({ type: "success", text: "기존 데이터에 백업 항목을 추가했습니다." });
    } catch (error) {
      setDataStatus({ type: "error", text: error.message });
    } finally {
      setDataBusy(false);
    }
  };

  const fullBackup = async () => {
    setDataBusy(true);
    setDataStatus(null);
    try {
      const result = await window.aaa.data.fullBackup(preferences);
      if (result.canceled) return;
      if (result.failures.length) {
        const failedNames = result.failures.map((failure) => failure.name).join(", ");
        setDataStatus({ type: "error", text: `전체 ${result.total}개 중 ${result.succeeded}개를 백업했습니다. 실패: ${failedNames} · 저장 위치: ${result.outputPath}` });
      } else {
        setDataStatus({ type: "success", text: `설정과 프로젝트 ${result.succeeded}개를 백업했습니다: ${result.outputPath}` });
      }
    } catch (error) {
      setDataStatus({ type: "error", text: error.message });
    } finally {
      setDataBusy(false);
    }
  };

  const setShortcut = (scope, key, value) => {
    const current = preferences[scope];
    const next = { ...current };
    const conflict = Object.keys(current).find((item) => item !== key && item !== "lineModifier" && current[item].toLowerCase() === value.toLowerCase());
    if (conflict) next[conflict] = current[key];
    next[key] = value;
    onChange({ ...preferences, [scope]: next });
  };

  const tabShortcuts = [["home", "홈"], ["management", "관리"], ["classification", "에셋 분류"], ["censorship", "에셋 검열"], ["progress", "진행률"]];
  const censorShortcuts = [["previous", "이전 이미지"], ["next", "다음 이미지"], ["undo", "작업 취소"], ["brushIncrease", "브러시 크기 증가"], ["brushDecrease", "브러시 크기 감소"], ["hardnessIncrease", "경도 증가"], ["hardnessDecrease", "경도 감소"], ["opacityIncrease", "불투명도 증가"], ["opacityDecrease", "불투명도 감소"], ["zoomIncrease", "화면 확대"], ["zoomDecrease", "화면 축소"]];

  return <div className="modal-backdrop settings-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onBack()}>
    <section className="app-settings-modal">
      <header className="settings-page-heading"><h1>설정</h1><button className="modal-close" aria-label="닫기" onClick={onBack}>×</button></header>
      <div className="app-settings-layout">
        <aside className="app-settings-sidebar" aria-label="설정 항목">
          {SETTINGS_TABS.map(([value, label, Icon]) => <button className={activeTab === value ? "active" : ""} key={value} onClick={() => setActiveTab(value)}><Icon size={18} /><span>{label}</span></button>)}
        </aside>

        <main className="app-settings-list">
          {activeTab === "general" && <>
            <section className="app-setting-section"><div><h2>테마</h2></div><div className="choice-buttons">{[["system", "시스템"], ["light", "라이트"], ["dark", "다크"]].map(([value, label]) => <button className={preferences.theme === value ? "active" : ""} key={value} onClick={() => onChange({ ...preferences, theme: value })}>{label}</button>)}</div></section>
          </>}

          {activeTab === "censorship" && <>
            <section className="app-setting-section global-censorship-setting"><div><h2>탐지 설정</h2></div><div className="global-censorship-fields">
              <label>검열 대상<div className="target-options">{[["nipple", "유두"], ["penis", "남성기"], ["vulva", "여성기"], ["anus", "항문"]].map(([value, label]) => <button className={preferences.censorship.targets.includes(value) ? "active" : ""} key={value} onClick={() => { const targets = preferences.censorship.targets.includes(value) ? preferences.censorship.targets.filter((item) => item !== value) : [...preferences.censorship.targets, value]; onChange({ ...preferences, censorship: { ...preferences.censorship, targets } }); }}>{label}</button>)}</div></label>
              <label>AI 탐지 신뢰도<div className="default-brush-range"><input type="range" min="1" max="100" value={preferences.censorship.confidence || 50} onChange={(event) => onChange({ ...preferences, censorship: { ...preferences.censorship, confidence: Number(event.target.value) } })} /><output>{preferences.censorship.confidence || 50}%</output></div></label>
              <label className="censorship-model-field">검열용 모델 파일<div className="directory-field"><input value={preferences.censorship.modelPath} onChange={(event) => onChange({ ...preferences, censorship: { ...preferences.censorship, modelPath: event.target.value } })} /><button className="outline-button" onClick={async () => { const modelPath = await window.aaa.chooseModel(); if (modelPath) onChange({ ...preferences, censorship: { ...preferences.censorship, modelPath } }); }}>찾아보기</button></div></label>
            </div></section>
            <section className="app-setting-section global-censorship-setting"><div><h2>기본 브러시</h2></div><div className="default-brush-grid">
              <label>방식<select value={preferences.censorship.method} onChange={(event) => onChange({ ...preferences, censorship: { ...preferences.censorship, method: event.target.value } })}><option value="solid">단색</option><option value="blur">블러</option><option value="mosaic">모자이크</option></select></label>
              <label>모양<div className="shape-options"><button className={preferences.censorship.shape === "circle" ? "active" : ""} title="원형" onClick={() => onChange({ ...preferences, censorship: { ...preferences.censorship, shape: "circle" } })}><Circle size={17} /></button><button className={preferences.censorship.shape === "square" ? "active" : ""} title="사각형" onClick={() => onChange({ ...preferences, censorship: { ...preferences.censorship, shape: "square" } })}><Square size={17} /></button></div></label>
              <label className="default-color-setting">색상<input type="color" value={preferences.censorship.color} onChange={(event) => onChange({ ...preferences, censorship: { ...preferences.censorship, color: event.target.value } })} /></label>
              {[["size", "크기", 1, 240], ["hardness", "경도", 0, 100], ["opacity", "불투명도", 0, 100]].map(([key, label, min, max]) => <label className="default-brush-range" key={key}><span>{label}</span><input type="range" min={min} max={max} value={preferences.censorship[key]} onChange={(event) => onChange({ ...preferences, censorship: { ...preferences.censorship, [key]: Number(event.target.value) } })} /><output>{preferences.censorship[key]}</output></label>)}
            </div></section>
          </>}

          {activeTab === "shortcuts" && <>
            <section className="app-setting-section shortcut-section"><div><h2>탭 이동</h2></div><div className="shortcut-group"><div className="shortcut-grid">{tabShortcuts.map(([key, label]) => <label key={key}><span>{label}</span><ShortcutInput value={preferences.shortcuts[key]} onChange={(value) => setShortcut("shortcuts", key, value)} /></label>)}</div></div></section>
            <section className="app-setting-section shortcut-section"><div><h2>에셋 검열</h2></div><div className="shortcut-group"><div className="shortcut-grid censorship-shortcut-grid">{censorShortcuts.map(([key, label]) => <label key={key}><span>{label}</span><ShortcutInput allowWheel value={preferences.censorShortcuts[key]} onChange={(value) => setShortcut("censorShortcuts", key, value)} /></label>)}<label><span>직선 긋기</span><span className="click-shortcut"><select value={preferences.censorShortcuts.lineModifier} onChange={(event) => setShortcut("censorShortcuts", "lineModifier", event.target.value)}><option value="disabled">사용 안 함</option><option value="ctrl">Ctrl</option><option value="shift">Shift</option><option value="alt">Alt</option></select><b>+ 클릭</b></span></label></div></div></section>
            <footer className="settings-tab-footer"><button className="outline-button shortcut-reset" onClick={() => onChange({ ...preferences, shortcuts: { ...DEFAULT_SHORTCUTS }, censorShortcuts: { ...DEFAULT_CENSOR_SHORTCUTS } })}>단축키 초기화</button></footer>
          </>}

          {activeTab === "data" && <div className="data-settings-page">
            <section className="app-setting-section data-setting-section"><div><h2>전체 백업</h2></div><div className="data-setting-action"><div className="data-setting-description"><p>설정 JSON과 모든 프로젝트를 각각 개별 ZIP 파일로 저장합니다.</p><p>프로젝트는 개별 복구 기능으로 하나씩 복구할 수 있습니다.</p></div><button className="primary-button button-with-icon data-setting-button" disabled={dataBusy} onClick={fullBackup}><FolderArchive size={16} />전체 백업</button></div></section>
            <section className="app-setting-section data-setting-section"><div><h2>설정 백업</h2></div><div className="data-setting-action"><p>기본 설정과 템플릿 설정을 JSON 파일로 저장합니다.</p><button className="primary-button button-with-icon data-setting-button" disabled={dataBusy} onClick={backupData}><Download size={16} />설정 백업</button></div></section>
            <section className="app-setting-section data-setting-section"><div><h2>설정 복구</h2></div><div className="data-setting-action"><p>JSON파일을 통해 설정을 복구합니다.</p><button className="outline-button button-with-icon data-setting-button" disabled={dataBusy} onClick={restoreData}><Upload size={16} />설정 복구</button></div></section>
            <div className="data-settings-status-area"><p className={`data-settings-status ${dataStatus?.type || "idle"}`} role="status" title={dataStatus?.text || ""}>{dataStatus?.text || ""}</p></div>
          </div>}

          {activeTab === "info" && <div className="app-info-page">
            <section className="app-setting-section app-info-logo-section">
              <div className="app-info-logo-slot" aria-hidden="true">
                <img className="app-info-logo app-brand-icon-light" src={aaaLogoBlack} alt="" />
                <img className="app-info-logo app-brand-icon-dark" src={aaaLogoWhite} alt="" />
              </div>
            </section>
            <section className="app-setting-section app-info-detail-section">
              <div className="app-info-detail-content">
                <div className="app-info-identity"><h2>AAA</h2><span>Asset Administration Assistant</span></div>
                <div className="app-info-version-card"><div><span>버전 {updateState.currentVersion || "0.1.0"}</span><button className={updateState.status === "available" ? "update-available" : ""} disabled={["checking", "downloading", "installing"].includes(updateState.status)} onClick={() => (updateState.status === "available" ? onInstallUpdate() : onCheckUpdate()).catch(() => {})}>{updateState.status === "available" ? "업데이트" : updateState.status === "checking" ? "확인 중..." : "버전 체크"}</button></div><p>{updateStatusText(updateState)}</p></div>
                <div className="app-info-links">
                  <button type="button" className="outline-button app-info-link" aria-label="GitHub" data-tooltip="GitHub" onClick={() => window.aaa.openExternal(GITHUB_URL)}>
                    <img className="app-brand-icon app-brand-icon-light" src={githubBlackIcon} alt="" />
                    <img className="app-brand-icon app-brand-icon-dark" src={githubWhiteIcon} alt="" />
                    <ExternalLink className="app-info-external-mark" size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className="outline-button app-info-link app-info-link-unavailable" aria-label="Discord" data-tooltip="Discord" aria-disabled="true">
                    <img className="app-brand-icon app-brand-icon-light" src={discordBlurpleIcon} alt="" />
                    <img className="app-brand-icon app-brand-icon-dark" src={discordWhiteIcon} alt="" />
                  </button>
                </div>
              </div>
            </section>
          </div>}
        </main>
      </div>
    </section>
  </div>;
}

export { AppSettings };
