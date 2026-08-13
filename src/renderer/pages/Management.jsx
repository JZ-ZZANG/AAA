import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, Copy, Eraser, Home as HomeIcon, LayoutGrid, Minus, Paintbrush, RectangleHorizontal, RectangleVertical, RotateCcw, Settings as SettingsIcon, Square, Trash2, X } from "lucide-react";
import {
  EXTENSIONS,
  ORIGINAL_EXTENSION,
  TRACKED_EXTENSIONS,
  editableRule,
  findPathRuleCollision,
  storedRule,
  normalizeProject
} from "../shared.js";
import { Progress } from "./Progress.jsx";
import { DeleteConfirmModal } from "../components/Shell.jsx";

function makeId() {
  return crypto.randomUUID();
}

function Settings({ project, onSaved }) {
  const [draft, setDraft] = useState(() => normalizeProject(project));
  const [ruleText, setRuleText] = useState(() => editableRule(project.pathTemplate, project.tags));
  const [message, setMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [syncingExternal, setSyncingExternal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [trackedExtension, setTrackedExtension] = useState(".png");
  const [showProgressModal, setShowProgressModal] = useState(false);
  const ruleInput = useRef(null);

  function updateDirectory(value) {
    setMessage("");
    const separator = value.includes("\\") ? "\\" : "/";
    setDraft({ ...draft, savePath: `${value.replace(/[\\/]+$/, "")}${separator}${draft.name.trim()}` });
  }

  function updateTag(id, patch) {
    const current = draft.tags.find((tag) => tag.id === id);
    if (current?.name && typeof patch.name === "string" && current.name !== patch.name) setRuleText((value) => value.replaceAll(`{${current.name}}`, `{${patch.name}}`));
    setDraft({ ...draft, tags: draft.tags.map((tag) => tag.id === id ? { ...tag, ...patch } : tag) });
  }

  function updateValues(tag, text) {
    const lines = text.split(/\r?\n/);
    updateTag(tag.id, { values: lines.map((line, index) => {
      const separator = line.indexOf("=");
      const label = separator >= 0 ? line.slice(0, separator) : line;
      const value = separator >= 0 ? line.slice(separator + 1) : line;
      return { id: tag.values[index]?.id || makeId(), label, value };
    }) });
  }

  function cleanDraft() {
    return {
      ...draft,
      tags: draft.tags.map((tag) => ({ ...tag, values: tag.values.filter((item) => (item.label || "").trim() || (item.value || "").trim()) })),
      pathTemplate: storedRule(ruleText, draft.tags),
      externalTracking: false
    };
  }

  async function save() {
    setMessage("");
    try {
      const cleaned = cleanDraft();
      for (const tag of cleaned.tags) {
        const labels = new Set();
        const values = new Set();
        for (const item of tag.values) {
          const label = (item.label || "").trim();
          const value = (item.value || "").trim();
          if (labels.has(label)) throw new Error(`${tag.name || "에셋 분류 기준"}에 중복된 키가 있습니다: ${label}`);
          if (values.has(value)) throw new Error(`${tag.name || "에셋 분류 기준"}에 중복된 값이 있습니다: ${value}`);
          labels.add(label);
          values.add(value);
        }
      }
      const collision = findPathRuleCollision(cleaned);
      if (collision) throw new Error(`에셋 저장 규칙에서 서로 다른 조합이 같은 경로를 만듭니다: ${collision.path} (${collision.first.join(", ")} / ${collision.second.join(", ")})`);
      const saved = normalizeProject(await window.aaa.projects.save(cleaned));
      setDraft(saved); setRuleText(editableRule(saved.pathTemplate, saved.tags)); setMessage("저장됨"); onSaved(saved);
    } catch (reason) { setMessage(reason.message); }
  }

  function confirmTagDelete() {
    if (!deleteTarget) return;
    const remainingTags = draft.tags.filter((tag) => tag.id !== deleteTarget.id);
    const hasDuplicateNames = new Set(draft.tags.map((tag) => tag.name)).size !== draft.tags.length;
    const internalRule = hasDuplicateNames ? draft.pathTemplate : storedRule(ruleText, draft.tags);
    const nextInternalRule = internalRule.replaceAll(`{tag:${deleteTarget.id}}`, "");
    setDraft({ ...draft, tags: remainingTags, pathTemplate: nextInternalRule });
    setRuleText(editableRule(nextInternalRule, remainingTags));
    setDeleteTarget(null);
  }

  function insertRuleText(text) {
    const input = ruleInput.current;
    const start = input?.selectionStart ?? ruleText.length;
    const end = input?.selectionEnd ?? ruleText.length;
    setRuleText(`${ruleText.slice(0, start)}${text}${ruleText.slice(end)}`);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + text.length, start + text.length);
    });
  }

  async function syncExternalFiles() {
    setSyncingExternal(true); setMessage("");
    try {
      await window.aaa.assets.syncExternal(draft.id, trackedExtension);
      setMessage("외부 변경 사항 갱신됨");
      setShowSyncModal(false);
    } catch (reason) { setMessage(reason.message); }
    finally { setSyncingExternal(false); }
  }

  return <><div className="settings-layout">
    <div className="settings-column">
      <section className="settings-main"><div className="project-settings-grid"><label>프로젝트 이름<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><div className="setting-control"><span>외부 변경 추적</span><button className="outline-button" disabled={syncingExternal} onClick={() => setShowSyncModal(true)}>{syncingExternal ? "갱신 중" : "외부 변경 추적 갱신"}</button></div><label>프로젝트 저장 위치<div className="directory-field"><input readOnly value={draft.savePath} /><button type="button" className="outline-button" onClick={async () => { const value = await window.aaa.chooseDirectory(); if (value) updateDirectory(value); }}>찾아보기</button><button type="button" className="outline-button" onClick={async () => { try { await window.aaa.openDirectory(draft.savePath); setMessage(""); } catch (reason) { setMessage(reason.message); } }}>폴더 열기</button></div></label><label>검열 에셋 저장 형식<select value={draft.censorshipConfig.enabled ? draft.censorshipConfig.outputExtension || ".png" : "none"} onChange={(event) => setDraft({ ...draft, censorshipConfig: { ...draft.censorshipConfig, enabled: event.target.value !== "none", ...(event.target.value !== "none" ? { outputExtension: event.target.value } : {}) } })}><option value="none">검열 없음</option><option value={ORIGINAL_EXTENSION}>원본과 동일</option>{EXTENSIONS.map((extension) => <option value={extension} key={extension}>{extension.slice(1).toUpperCase()}</option>)}</select></label></div></section>
      <section className="classification-settings"><div className="settings-heading"><h2>에셋 분류 기준</h2><button className="outline-button" onClick={() => setDraft({ ...draft, tags: [...draft.tags, { id: makeId(), name: "", values: [{ id: makeId(), label: "", value: "" }] }] })}>＋ 추가</button></div><div className="tag-list">{draft.tags.map((tag) => <article className="tag-card" key={tag.id}><input className="tag-name" value={tag.name} onChange={(event) => updateTag(tag.id, { name: event.target.value })} placeholder="에셋 분류 키워드" /><textarea value={tag.values.map((item) => item.label === item.value ? item.label : `${item.label || ""}=${item.value || ""}`).join("\n")} onChange={(event) => updateValues(tag, event.target.value)} placeholder="키워드=저장값" /><button className="remove-button" aria-label={`${tag.name || "에셋 분류 기준"} 삭제`} onClick={() => setDeleteTarget(tag)}>×</button></article>)}</div></section>
    </div>
    <aside className="settings-side-column"><section className="rule-card"><div className="rule-heading"><h2>에셋 저장 규칙</h2></div><div className="rule-text-field"><input ref={ruleInput} value={ruleText} onChange={(event) => setRuleText(event.target.value)} spellCheck="false" /><span>.확장자</span></div><div className="token-list">{draft.tags.map((tag) => tag.name && <button key={tag.id} onClick={() => insertRuleText(`{${tag.name}}`)}>{tag.name}</button>)}</div>{message && <p className={message === "저장됨" || message.endsWith("갱신됨") ? "success" : "error"}>{message}</p>}<button className="primary-button full" onClick={save}>설정 저장</button></section><section className="progress-launch-card"><h2>에셋 작업률</h2><button className="outline-button full" onClick={() => setShowProgressModal(true)}>에셋 작업률 확인</button>{showProgressModal && <div className="modal-backdrop progress-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowProgressModal(false)}><section className="modal progress-modal"><div className="modal-heading"><h2>에셋 작업률</h2><button className="modal-close" onClick={() => setShowProgressModal(false)}>×</button></div><div className="progress-modal-content"><Progress project={project} refreshVersion={0} /></div></section></div>}</section></aside>
  </div>{showSyncModal && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowSyncModal(false)}><section className="modal"><div className="modal-heading"><h2>추적할 파일 확장자 선택</h2><button className="modal-close" onClick={() => setShowSyncModal(false)}>×</button></div><label>파일 확장자<select autoFocus value={trackedExtension} onChange={(event) => setTrackedExtension(event.target.value)}>{TRACKED_EXTENSIONS.map((extension) => <option value={extension} key={extension}>{extension.slice(1).toUpperCase()}</option>)}</select></label><div className="modal-actions"><button className="text-button" onClick={() => setShowSyncModal(false)}>취소</button><button className="primary-button" disabled={syncingExternal} onClick={syncExternalFiles}>{syncingExternal ? "갱신 중" : "갱신"}</button></div></section></div>}{deleteTarget && <DeleteConfirmModal title="에셋 분류 기준 삭제" target={deleteTarget.name || "이름 없는 에셋 분류 기준"} onClose={() => setDeleteTarget(null)} onConfirm={confirmTagDelete} />}</>;
}

export { Settings };
