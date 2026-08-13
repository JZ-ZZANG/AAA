import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, Copy, Eraser, Home as HomeIcon, LayoutGrid, Minus, Paintbrush, RectangleHorizontal, RectangleVertical, RotateCcw, Settings as SettingsIcon, Square, Trash2, X } from "lucide-react";
import { DEFAULT_SHORTCUTS, DEFAULT_CENSOR_SHORTCUTS, DEFAULT_CENSORSHIP, normalizeProject, matchesShortcut, flushCensorEdits } from "./shared.js";
import { WindowControls, Modal, DeleteConfirmModal, ProjectTitlebarNav } from "./components/Shell.jsx";
import { Home } from "./pages/Home.jsx";
import { AppSettings } from "./pages/AppSettings.jsx";
import { ProjectPage } from "./pages/ProjectPage.jsx";
import { TemplateSettings } from "./pages/TemplateSettings.jsx";
import { GifMaker } from "./pages/GifMaker.jsx";

export default function App() {
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [globalDataVersion, setGlobalDataVersion] = useState(0);
  const [showGifMaker, setShowGifMaker] = useState(false);
  const [deleteProject, setDeleteProject] = useState(null);
  const [deleteProjectName, setDeleteProjectName] = useState("");
  const [updateState, setUpdateState] = useState({ status: "checking", currentVersion: "", latestVersion: "", percent: 0, message: "" });
  const closing = useRef(false);
  const [preferences, setPreferences] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem("aaa-preferences") || "{}"); return { theme: "system", columns: 4, ratio: "square", ...saved, shortcuts: { ...DEFAULT_SHORTCUTS, ...saved.shortcuts }, censorShortcuts: { ...DEFAULT_CENSOR_SHORTCUTS, ...saved.censorShortcuts }, censorship: { ...DEFAULT_CENSORSHIP, ...saved.censorship } }; }
    catch { return { theme: "system", columns: 4, ratio: "square", shortcuts: DEFAULT_SHORTCUTS, censorShortcuts: DEFAULT_CENSOR_SHORTCUTS, censorship: DEFAULT_CENSORSHIP }; }
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = preferences.theme === "system" ? (media.matches ? "dark" : "light") : preferences.theme;
      document.documentElement.dataset.theme = resolved;
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    localStorage.setItem("aaa-preferences", JSON.stringify(preferences));
    return () => media.removeEventListener("change", applyTheme);
  }, [preferences]);

  async function loadProjects() { setProjects(await window.aaa.projects.list()); setLoading(false); }
  useEffect(() => { loadProjects().catch(() => setLoading(false)); }, []);
  useEffect(() => {
    window.aaa.updates.getState().then(setUpdateState).catch(() => setUpdateState((current) => ({ ...current, status: "error" })));
    return window.aaa.updates.onStateChanged(setUpdateState);
  }, []);
  useEffect(() => window.aaa.window.onCloseRequested(async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      await flushCensorEdits();
      await window.aaa.window.confirmClose();
    } catch (error) {
      closing.current = false;
      alert(`저장하지 못해 종료하지 않았습니다.\n${error.message}`);
    }
  }), []);
  useEffect(() => { const listener = (event) => { if (project || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return; if (matchesShortcut(event, preferences.shortcuts.home)) { event.preventDefault(); setShowSettings(false); setShowTemplates(false); setShowGifMaker(false); } }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, [project, preferences.shortcuts.home]);
  useEffect(() => { setDeleteProjectName(""); }, [deleteProject]);
  async function openProject(id) { setProject(normalizeProject(await window.aaa.projects.get(id))); }

  const updateBlocking = ["downloading", "installing"].includes(updateState.status);
  return <div className="app"><div className="window-drag-region" /><WindowControls /><button className={`global-settings-titlebar ${showSettings ? "active" : ""}`} aria-label="설정" title="설정" onClick={() => setShowSettings(true)}><SettingsIcon size={18} /></button>{!project && !showTemplates && !showGifMaker && <ProjectTitlebarNav project={null} tab="home" homeActive onHome={() => {}} />}{showGifMaker ? <GifMaker onBack={() => setShowGifMaker(false)} /> : showTemplates ? <TemplateSettings key={globalDataVersion} onBack={() => setShowTemplates(false)} /> : project ? <ProjectPage project={project} suspended={showSettings} onBack={() => { setProject(null); loadProjects(); }} onProjectChanged={(saved) => setProject(normalizeProject(saved))} classificationLayout={{ columns: preferences.columns, ratio: preferences.ratio }} onClassificationLayoutChange={(layout) => setPreferences({ ...preferences, ...layout })} /> : <Home projects={projects} loading={loading} onCreate={() => setModal(true)} onOpen={openProject} onDelete={setDeleteProject} onTemplates={() => setShowTemplates(true)} onGifMaker={() => setShowGifMaker(true)} />}{showSettings && <AppSettings preferences={preferences} onChange={setPreferences} onBack={() => setShowSettings(false)} updateState={updateState} onCheckUpdate={() => window.aaa.updates.check()} onInstallUpdate={() => window.aaa.updates.install()} onDataRestored={() => setGlobalDataVersion((current) => current + 1)} />}{modal && <Modal onClose={() => setModal(false)} onCreated={(created) => { setModal(false); setProject(normalizeProject(created)); }} />}{deleteProject && <DeleteConfirmModal title="프로젝트 삭제" target={deleteProject.name} confirmDisabled={deleteProjectName !== deleteProject.name} onClose={() => setDeleteProject(null)} onConfirm={async () => { await window.aaa.projects.delete(deleteProject.id); setDeleteProject(null); loadProjects(); }}><label className="project-delete-confirmation"><span>확인을 위해 프로젝트 이름을 입력하세요.</span><input autoFocus value={deleteProjectName} onChange={(event) => setDeleteProjectName(event.target.value)} placeholder={deleteProject.name} /></label></DeleteConfirmModal>}{updateBlocking && <div className="update-blocking-overlay" role="alert" aria-live="assertive"><div className="update-blocking-dialog"><div className="update-progress-track"><span style={{ width: `${updateState.status === "installing" ? 100 : updateState.percent}%` }} /></div><strong>{updateState.status === "installing" ? "업데이트를 설치하기 위해 앱을 종료합니다." : "업데이트를 다운로드하는 중입니다."}</strong>{updateState.status === "downloading" && <span>{Math.round(updateState.percent)}%</span>}</div></div>}</div>;
}
