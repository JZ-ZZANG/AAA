import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FolderArchive, Info, Keyboard, Palette, Plus, ShieldCheck, Star, Trash2, Upload } from "lucide-react";
import { CENSOR_TARGET_OPTIONS, DEFAULT_SHORTCUTS, DEFAULT_CENSOR_SHORTCUTS, DEFAULT_CENSORSHIP, DEFAULT_STICKERS } from "../shared.js";
import { normalizedStickerFavoriteIds, publishStickerFavoriteIds } from "../sticker-favorites.js";
import { TWEMOJI_CATEGORIES, categorizedTwemojiIds, twemojiCharacter, twemojiSticker } from "../twemoji-library.js";
import { DeleteConfirmModal, ShortcutInput } from "../components/Shell.jsx";
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
const DISCORD_URL = "https://discord.gg/hq4fvU5UGx";
const STICKER_PICKER_PAGE_SIZE = 96;
const CUSTOM_STICKERS_EVENT = "aaa-custom-stickers-changed";
const AI_RUNTIME_CHANGED_EVENT = "aaa-ai-runtime-changed";

function formattedBytes(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
  return `${Math.round(bytes / 1024 ** 2)}MB`;
}

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
  next.stickers = {
    ...DEFAULT_STICKERS,
    ...current.stickers,
    favoriteEmojiIds: Array.isArray(source.stickers?.favoriteEmojiIds) ? normalizedStickerFavoriteIds(source.stickers.favoriteEmojiIds) : normalizedStickerFavoriteIds(current.stickers?.favoriteEmojiIds)
  };
  return next;
}

function AppSettings({ preferences, onChange, onBack, updateState, onCheckUpdate, onInstallUpdate, onDataRestored }) {
  const [activeTab, setActiveTab] = useState("general");
  const [dataBusy, setDataBusy] = useState(false);
  const [dataStatus, setDataStatus] = useState(null);
  const [customStickers, setCustomStickers] = useState([]);
  const [stickerError, setStickerError] = useState("");
  const [favoritePickerOpen, setFavoritePickerOpen] = useState(false);
  const [favoritePickerCategory, setFavoritePickerCategory] = useState("smileys");
  const [favoritePickerLimit, setFavoritePickerLimit] = useState(STICKER_PICKER_PAGE_SIZE);
  const [deleteStickerTarget, setDeleteStickerTarget] = useState(null);
  const [stickerDeleting, setStickerDeleting] = useState(false);
  const [aiRuntime, setAiRuntime] = useState({ installed: false, version: "", compatible: false, loading: true });
  const [aiRuntimeBusy, setAiRuntimeBusy] = useState(false);
  const [aiRuntimeProgress, setAiRuntimeProgress] = useState(null);
  const [aiRuntimeMessage, setAiRuntimeMessage] = useState("");
  const [aiInstallMenuOpen, setAiInstallMenuOpen] = useState(false);
  const aiInstallMenuRef = useRef(null);

  useEffect(() => {
    let active = true;
    window.aaa.stickers.list().then((items) => { if (active) setCustomStickers(items); }).catch((error) => { if (active) setStickerError(error.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!aiInstallMenuOpen) return undefined;
    const closeMenu = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !aiInstallMenuRef.current?.contains(event.target)) setAiInstallMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeMenu);
    };
  }, [aiInstallMenuOpen]);
  useEffect(() => setFavoritePickerLimit(STICKER_PICKER_PAGE_SIZE), [favoritePickerCategory]);
  useEffect(() => {
    let active = true;
    window.aaa.aiRuntime.status().then((status) => { if (active) setAiRuntime({ ...status, loading: false }); }).catch((error) => { if (active) { setAiRuntime((current) => ({ ...current, loading: false })); setAiRuntimeMessage(error.message); } });
    const unsubscribe = window.aaa.aiRuntime.onProgress((progress) => { if (active) setAiRuntimeProgress(progress); });
    return () => { active = false; unsubscribe(); };
  }, []);

  const favoriteEmojiIds = normalizedStickerFavoriteIds(preferences.stickers?.favoriteEmojiIds);
  const favoritePickerIds = categorizedTwemojiIds[favoritePickerCategory] || [];

  const updateFavoriteEmojiIds = (ids) => {
    const favoriteEmojiIds = publishStickerFavoriteIds(ids);
    onChange({ ...preferences, stickers: { ...DEFAULT_STICKERS, ...preferences.stickers, favoriteEmojiIds } });
  };

  const toggleFavoriteEmoji = (id) => {
    updateFavoriteEmojiIds(favoriteEmojiIds.includes(id) ? favoriteEmojiIds.filter((item) => item !== id) : [...favoriteEmojiIds, id]);
  };

  const addCustomStickers = async () => {
    try {
      const items = await window.aaa.stickers.add();
      setCustomStickers(items);
      window.dispatchEvent(new CustomEvent(CUSTOM_STICKERS_EVENT, { detail: items }));
      setStickerError("");
    } catch (error) { setStickerError(error.message); }
  };

  const removeCustomSticker = async () => {
    if (!deleteStickerTarget || stickerDeleting) return;
    setStickerDeleting(true);
    try {
      const items = await window.aaa.stickers.delete(deleteStickerTarget.id);
      setCustomStickers(items);
      window.dispatchEvent(new CustomEvent(CUSTOM_STICKERS_EVENT, { detail: items }));
      setDeleteStickerTarget(null);
      setStickerError("");
    } catch (error) { setStickerError(error.message); }
    finally { setStickerDeleting(false); }
  };

  const checkAiRuntime = async () => {
    setAiRuntimeBusy(true);
    setAiRuntimeMessage("");
    try {
      const status = await window.aaa.aiRuntime.check();
      setAiRuntime({ ...status, loading: false });
      setAiRuntimeMessage(status.updateAvailable ? "업데이트가 있습니다" : "최신 버전입니다");
    } catch (error) { setAiRuntimeMessage(error.message); }
    finally { setAiRuntimeBusy(false); }
  };

  const installAiRuntime = async (fromFile = false) => {
    setAiInstallMenuOpen(false);
    setAiRuntimeBusy(true);
    setAiRuntimeProgress({ stage: "preparing", percent: 0, message: "AI 검열 기능 준비 중" });
    setAiRuntimeMessage("");
    try {
      const status = fromFile ? await window.aaa.aiRuntime.installFromFile() : await window.aaa.aiRuntime.install();
      if (status.canceled) { setAiRuntimeProgress(null); return; }
      setAiRuntime({ ...status, loading: false });
      window.dispatchEvent(new CustomEvent(AI_RUNTIME_CHANGED_EVENT, { detail: status }));
      setAiRuntimeMessage(`AI 검열 기능 ${status.version} 설치 완료`);
    } catch (error) {
      setAiRuntimeMessage(error.message);
    } finally {
      setAiRuntimeBusy(false);
      setAiRuntimeProgress(null);
    }
  };

  const runAiRuntimeAction = () => {
    if (!aiRuntime.compatible || aiRuntime.updateAvailable) return installAiRuntime();
    return checkAiRuntime();
  };

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
      publishStickerFavoriteIds(nextPreferences.stickers.favoriteEmojiIds);
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

  const tabShortcuts = [["home", "홈"], ["management", "관리"], ["work", "작품"], ["prompts", "프롬프트"], ["lorebook", "로어북"], ["situation", "시작 상황"], ["classification", "에셋 분류"], ["censorship", "에셋 검열"], ["export", "내보내기"], ["settings", "설정"]];
  const censorShortcuts = [["previous", "이전 이미지"], ["manualToggle", "수동 확인 / 대기"], ["next", "다음 이미지"], ["originalPreview", "원본 보기 (홀드)"], ["brushEraserToggle", "브러시 / 지우개"], ["methodCycle", "단색 / 블러 / 모자이크"], ["shapeToggle", "원형 / 사각형"], ["sidebarToggle", "사이드바 열기 / 닫기"], ["undo", "작업 취소"], ["redo", "다시 실행"], ["brushIncrease", "브러시 크기 증가"], ["brushDecrease", "브러시 크기 감소"], ["hardnessIncrease", "경도 증가"], ["hardnessDecrease", "경도 감소"], ["opacityIncrease", "불투명도 증가"], ["opacityDecrease", "불투명도 감소"], ["zoomIncrease", "화면 확대"], ["zoomDecrease", "화면 축소"]];

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
            <section className="app-setting-section global-censorship-setting"><div><h2>AI 검열 설정 기본값</h2></div><fieldset className="global-censorship-fields" disabled={!aiRuntime.available}>
              <label className="censorship-target-field">검열 대상<div className="target-options">{CENSOR_TARGET_OPTIONS.map(([value, label]) => <button className={preferences.censorship.targets.includes(value) ? "active" : ""} key={value} onClick={() => { const targets = preferences.censorship.targets.includes(value) ? preferences.censorship.targets.filter((item) => item !== value) : [...preferences.censorship.targets, value]; onChange({ ...preferences, censorship: { ...preferences.censorship, targets } }); }}>{label}</button>)}</div></label>
              <label>입력 해상도<input type="number" min="320" max="4096" step="32" value={preferences.censorship.imageSize || 1024} onChange={(event) => onChange({ ...preferences, censorship: { ...preferences.censorship, imageSize: Math.max(320, Math.min(4096, Number(event.target.value) || 1024)) } })} /></label>
              <label>AI 탐지 신뢰도<div className="number-with-unit"><input type="number" min="1" max="100" value={preferences.censorship.confidence || 50} onChange={(event) => onChange({ ...preferences, censorship: { ...preferences.censorship, confidence: Math.max(1, Math.min(100, Number(event.target.value) || 1)) } })} /><span>%</span></div></label>
              <label className="censorship-model-field">검열용 모델 파일<div className="directory-field"><input value={preferences.censorship.modelPath} onChange={(event) => onChange({ ...preferences, censorship: { ...preferences.censorship, modelPath: event.target.value } })} /><button className="outline-button" onClick={async () => { const modelPath = await window.aaa.chooseModel(); if (modelPath) onChange({ ...preferences, censorship: { ...preferences.censorship, modelPath } }); }}>찾아보기</button></div></label>
            </fieldset></section>
            <section className="app-setting-section global-censorship-setting"><div><h2>브러쉬 설정 기본값</h2></div><div className="default-brush-grid">
              <div className="default-brush-row two-columns">
                <label>방식<select value={preferences.censorship.method} onChange={(event) => onChange({ ...preferences, censorship: { ...preferences.censorship, method: event.target.value } })}><option value="solid">단색</option><option value="blur">블러</option><option value="mosaic">모자이크</option></select></label>
                <label className="default-color-setting" onClick={(event) => { if (!event.target.closest(".brush-color-control")) event.preventDefault(); }}>색상<div className={`brush-color-control ${preferences.censorship.method !== "solid" ? "disabled" : ""}`}><span aria-hidden="true"><Palette size={17} /></span><input type="color" aria-label="기본 브러쉬 색상" disabled={preferences.censorship.method !== "solid"} value={preferences.censorship.color} onChange={(event) => onChange({ ...preferences, censorship: { ...preferences.censorship, color: event.target.value } })} /></div></label>
              </div>
              <div className="default-brush-row two-columns">
                {[["size", "크기", 1, 240, "px"], ["hardness", "경도", 0, 100, "%"], ["opacity", "불투명도", 0, 100, "%"], ["dilation", "자동 검열 시 마스크 확장", 0, 100, "px"]].map(([key, label, min, max, unit]) => <label key={key}><span>{label}</span><div className="number-with-unit"><input type="number" min={min} max={max} value={preferences.censorship[key] || min} onChange={(event) => onChange({ ...preferences, censorship: { ...preferences.censorship, [key]: Math.max(min, Math.min(max, Number(event.target.value) || min)) } })} /><span>{unit}</span></div></label>)}
              </div>
            </div></section>
            <section className="app-setting-section global-sticker-setting"><div><h2>스티커</h2></div><div className="global-sticker-management">
              <section className="global-sticker-group">
                <header><h3>자주 쓰는 이모지</h3><button type="button" className={`outline-button button-with-icon ${favoritePickerOpen ? "active" : ""}`} onClick={() => setFavoritePickerOpen((current) => !current)}><Star size={14} />이모지 추가</button></header>
                {favoriteEmojiIds.length ? <div className="global-favorite-emoji-list">{favoriteEmojiIds.map((id) => { const sticker = twemojiSticker(id); return <div className="global-sticker-item emoji" key={id}><img src={sticker.url} alt={sticker.name} /><button type="button" aria-label={`${sticker.name} 목록에서 제거`} data-tooltip="목록에서 제거" onClick={() => updateFavoriteEmojiIds(favoriteEmojiIds.filter((item) => item !== id))}><Trash2 size={12} /></button></div>; })}</div> : <p className="global-sticker-empty">등록된 이모지가 없습니다.</p>}
                {favoritePickerOpen && <div className="global-emoji-picker">
                  <select aria-label="이모지 카테고리" value={favoritePickerCategory} onChange={(event) => setFavoritePickerCategory(event.target.value)}>{TWEMOJI_CATEGORIES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
                  <div className="global-emoji-picker-grid" onScroll={(event) => { const list = event.currentTarget; if (list.scrollHeight - list.scrollTop - list.clientHeight <= 48) setFavoritePickerLimit((current) => Math.min(current + STICKER_PICKER_PAGE_SIZE, favoritePickerIds.length)); }}>
                    {favoritePickerIds.slice(0, favoritePickerLimit).map((id) => { const sticker = twemojiSticker(id); const selected = favoriteEmojiIds.includes(id); return <button type="button" className={selected ? "active" : ""} aria-pressed={selected} title={`${twemojiCharacter(id)} · U+${id.toUpperCase().replaceAll("-", " U+")}`} key={id} onClick={() => toggleFavoriteEmoji(id)}><img src={sticker.url} alt={sticker.name} loading="lazy" />{selected && <Star size={11} fill="currentColor" />}</button>; })}
                  </div>
                </div>}
              </section>
              <section className="global-sticker-group">
                <header><h3>추가한 이미지</h3><button type="button" className="outline-button button-with-icon" onClick={addCustomStickers}><Plus size={14} />스티커 추가</button></header>
                {customStickers.length ? <div className="global-custom-sticker-list">{customStickers.map((sticker) => <div className="global-sticker-item custom" key={sticker.id}><img src={sticker.url} alt="" /><span title={sticker.name}>{sticker.name}</span><button type="button" aria-label={`${sticker.name} 삭제`} data-tooltip="삭제" onClick={() => setDeleteStickerTarget(sticker)}><Trash2 size={12} /></button></div>)}</div> : <p className="global-sticker-empty">추가한 이미지가 없습니다.</p>}
              </section>
              {stickerError && <p className="error">{stickerError}</p>}
            </div></section>
          </>}

          {activeTab === "shortcuts" && <>
            <section className="app-setting-section shortcut-section"><div><h2>탭 이동</h2></div><div className="shortcut-group"><div className="shortcut-grid">{tabShortcuts.map(([key, label]) => <label key={key}><span>{label}</span><ShortcutInput value={preferences.shortcuts[key]} onChange={(value) => setShortcut("shortcuts", key, value)} /></label>)}</div></div></section>
            <section className="app-setting-section shortcut-section"><div><h2>에셋 검열</h2></div><div className="shortcut-group"><div className="shortcut-grid censorship-shortcut-grid">{censorShortcuts.map(([key, label]) => <label key={key}><span>{label}</span><ShortcutInput allowWheel value={preferences.censorShortcuts[key]} onChange={(value) => setShortcut("censorShortcuts", key, value)} /></label>)}<label><span>영역 그리기</span><span className="click-shortcut"><b>Ctrl + 드래그</b></span></label><label><span>정비율 영역</span><span className="click-shortcut"><b>Shift + 드래그</b></span></label><label><span>직선 긋기</span><span className="click-shortcut"><select value={preferences.censorShortcuts.lineModifier} onChange={(event) => setShortcut("censorShortcuts", "lineModifier", event.target.value)}><option value="disabled">사용 안 함</option><option value="shift">Shift</option><option value="alt">Alt</option></select><b>+ 클릭</b></span></label></div></div></section>
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
                <div className="app-info-package-grid">
                  <div className="app-info-version-card"><div className="app-info-package-heading"><div><strong>AAA</strong><span>버전 {updateState.currentVersion || "0.1.0"}</span></div><button className={updateState.status === "available" ? "update-available" : ""} disabled={["checking", "downloading", "installing"].includes(updateState.status)} onClick={() => (updateState.status === "available" ? onInstallUpdate() : onCheckUpdate()).catch(() => {})}>{updateState.status === "available" ? "업데이트" : updateState.status === "checking" ? "확인 중..." : "버전 체크"}</button></div><p>{updateStatusText(updateState)}</p></div>
                  <div className="app-info-ai-card">
                    <div className="app-info-package-heading"><div><strong>AI 검열 패키지</strong><span>{aiRuntime.loading ? "버전 확인 중" : aiRuntime.installed ? `버전 ${aiRuntime.version}` : "버전 -"}</span></div><div className="app-info-install-action" ref={aiInstallMenuRef}><button className={aiRuntime.updateAvailable || (aiRuntime.installed && !aiRuntime.compatible) ? "update-available" : ""} type="button" aria-expanded={!aiRuntime.installed ? aiInstallMenuOpen : undefined} disabled={aiRuntimeBusy || aiRuntime.loading} onClick={() => { if (!aiRuntime.installed) setAiInstallMenuOpen((current) => !current); else runAiRuntimeAction().catch(() => {}); }}>{aiRuntimeBusy ? aiRuntimeProgress ? "설치 중..." : "확인 중..." : !aiRuntime.installed ? "설치" : aiRuntime.updateAvailable || !aiRuntime.compatible ? "업데이트" : "버전 체크"}</button>{!aiRuntime.installed && aiInstallMenuOpen && <div className="ai-install-options"><button type="button" onClick={() => installAiRuntime(false)}>자동 설치</button><button type="button" onClick={() => installAiRuntime(true)}>수동 설치</button></div>}</div></div>
                    <p>{aiRuntime.loading ? "확인 중" : !aiRuntime.installed ? "설치되지 않음" : !aiRuntime.compatible ? "현재 AAA 버전과 호환되지 않습니다." : "설치되어 있습니다."}</p>
                    {!aiRuntime.loading && aiRuntime.latestVersion && aiRuntime.updateAvailable && <p>최신 버전 {aiRuntime.latestVersion}{aiRuntime.downloadSize ? ` · ${formattedBytes(aiRuntime.downloadSize)}` : ""}</p>}
                    {aiRuntimeProgress && <div className="ai-runtime-progress"><div><span style={{ width: `${aiRuntimeProgress.percent || 0}%` }} /></div><p>{aiRuntimeProgress.message}{aiRuntimeProgress.stage === "downloading" && aiRuntimeProgress.percent ? ` · ${aiRuntimeProgress.percent}%` : ""}</p></div>}
                    <p className={`ai-runtime-message ${aiRuntimeMessage.includes("실패") || aiRuntimeMessage.includes("못했") || aiRuntimeMessage.includes("않습니다") ? "error" : ""}`}>{aiRuntimeMessage}</p>
                  </div>
                </div>
                <div className="app-info-links">
                  <button type="button" className="outline-button app-info-link" aria-label="GitHub" data-tooltip="GitHub" onClick={() => window.aaa.openExternal(GITHUB_URL)}>
                    <img className="app-brand-icon app-brand-icon-light" src={githubBlackIcon} alt="" />
                    <img className="app-brand-icon app-brand-icon-dark" src={githubWhiteIcon} alt="" />
                    <ExternalLink className="app-info-external-mark" size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className="outline-button app-info-link" aria-label="Discord" data-tooltip="Discord" onClick={() => window.aaa.openExternal(DISCORD_URL)}>
                    <img className="app-brand-icon app-brand-icon-light" src={discordBlurpleIcon} alt="" />
                    <img className="app-brand-icon app-brand-icon-dark" src={discordWhiteIcon} alt="" />
                    <ExternalLink className="app-info-external-mark" size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </section>
          </div>}
        </main>
      </div>
    </section>
    {deleteStickerTarget && <DeleteConfirmModal title="스티커 삭제" target={deleteStickerTarget.name} busy={stickerDeleting} onClose={() => setDeleteStickerTarget(null)} onConfirm={removeCustomSticker} />}
  </div>;
}

export { AppSettings };
