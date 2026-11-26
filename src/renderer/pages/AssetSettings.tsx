import { useRef, useState } from "react";
import {
  EXTENSIONS,
  ORIGINAL_EXTENSION,
  TRACKED_EXTENSIONS,
  classificationTagAreas,
  editableRule,
  findPathRuleCollision,
  storedRule,
  normalizeProject
} from "../shared";
import { Progress } from "./Progress";
import { DeleteConfirmModal } from "../components/Shell";

function makeId() {
  return crypto.randomUUID();
}

function AssetSettings({ project, onSaved, layout, onLayoutChange, onAssetsChanged }) {
  const [draft, setDraft] = useState(() => normalizeProject(project));
  const [ruleText, setRuleText] = useState(() => editableRule(project.pathTemplate, project.tags));
  const [message, setMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [syncingExternal, setSyncingExternal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [trackedExtension, setTrackedExtension] = useState(".png");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const ruleInput = useRef(null);
  const [saving, setSaving] = useState(false);
  const [draftLayout, setDraftLayout] = useState(layout);
  const template = storedRule(ruleText, draft.tags);
  const ruleTags = draft.tags.filter((tag) => template.includes(`{tag:${tag.id}}`));
  const { sidebarTagIds, cardTagIds, topbarTagIds } = classificationTagAreas(ruleTags, draftLayout);
  const sidebarTags = ruleTags.filter((tag) => sidebarTagIds.includes(tag.id));
  const topbarTags = ruleTags.filter((tag) => topbarTagIds.includes(tag.id));
  const cardTags = ruleTags.filter((tag) => cardTagIds.includes(tag.id));
  const cardCount = cardTags.reduce((count, tag) => count * tag.values.length, 1);

  function setTagArea(tagId, area) {
    const nextSidebarTagIds = sidebarTagIds.filter((id) => id !== tagId);
    const nextTopbarTagIds = topbarTagIds.filter((id) => id !== tagId);
    if (area === "sidebar") nextSidebarTagIds.push(tagId);
    if (area === "topbar") nextTopbarTagIds.push(tagId);
    setDraftLayout({ ...draftLayout, sidebarTagIds: nextSidebarTagIds, topbarTagIds: nextTopbarTagIds });
  }

  function updateDirectory(value) {
    setMessage("");
    setDraft({ ...draft, savePath: value });
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
      name: project.name,
      tags: draft.tags.map((tag) => ({ ...tag, values: tag.values.filter((item) => (item.label || "").trim() || (item.value || "").trim()) })),
      pathTemplate: storedRule(ruleText, draft.tags),
      externalTracking: false
    };
  }

  async function save() {
    setMessage(""); setSaving(true);
    try {
      if (!draft.savePath.trim()) throw new Error("에셋 위치를 지정해 주세요.");
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
      setDraft(saved); setRuleText(editableRule(saved.pathTemplate, saved.tags)); setMessage("저장됨"); onLayoutChange(draftLayout); onSaved(saved);
    } catch (reason) { setMessage(reason.message); }
    finally { setSaving(false); }
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
      await window.aaa.assets.syncExternal(project.id, trackedExtension);
      await onAssetsChanged();
      setRefreshVersion((current) => current + 1);
      setMessage("외부 변경 사항 갱신됨");
      setShowSyncModal(false);
    } catch (reason) { setMessage(reason.message); }
    finally { setSyncingExternal(false); }
  }

  return <>{showSyncModal && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowSyncModal(false)}><section className="modal"><div className="modal-heading"><h2>추적할 파일 확장자 선택</h2><button className="modal-close" onClick={() => setShowSyncModal(false)}>×</button></div><label>파일 확장자<select autoFocus value={trackedExtension} onChange={(event) => setTrackedExtension(event.target.value)}>{TRACKED_EXTENSIONS.map((extension) => <option value={extension} key={extension}>{extension.slice(1).toUpperCase()}</option>)}</select></label><div className="modal-actions"><button className="text-button" onClick={() => setShowSyncModal(false)}>취소</button><button className="primary-button" disabled={syncingExternal} onClick={syncExternalFiles}>{syncingExternal ? "갱신 중" : "갱신"}</button></div></section></div>}<div className="settings-layout">
    <div className="settings-column">
      <section className="settings-main"><div className="asset-location-settings"><label>에셋 위치 지정<div className="directory-field"><input readOnly value={draft.savePath} /><button type="button" className="outline-button" onClick={async () => { const value = await window.aaa.chooseDirectory(); if (value) updateDirectory(value); }}>찾아보기</button><button type="button" className="outline-button" disabled={!draft.savePath} onClick={async () => { try { await window.aaa.openDirectory(draft.savePath); setMessage(""); } catch (reason) { setMessage(reason.message); } }}>폴더 열기</button></div></label><label>검열 에셋 저장 형식<select value={draft.censorshipConfig.enabled ? draft.censorshipConfig.outputExtension || ".png" : "none"} onChange={(event) => setDraft({ ...draft, censorshipConfig: { ...draft.censorshipConfig, enabled: event.target.value !== "none", ...(event.target.value !== "none" ? { outputExtension: event.target.value } : {}) } })}><option value="none">검열 없음</option><option value={ORIGINAL_EXTENSION}>원본과 동일</option>{EXTENSIONS.map((extension) => <option value={extension} key={extension}>{extension.slice(1).toUpperCase()}</option>)}</select></label></div></section>
      <section className="classification-settings"><div className="settings-heading"><h2>에셋 분류 기준</h2><button className="outline-button" onClick={() => setDraft({ ...draft, tags: [...draft.tags, { id: makeId(), name: "", values: [{ id: makeId(), label: "", value: "" }] }] })}>＋ 추가</button></div><div className="tag-list">{draft.tags.map((tag) => <article className="tag-card" key={tag.id}><input className="tag-name" value={tag.name} onChange={(event) => updateTag(tag.id, { name: event.target.value })} placeholder="에셋 분류 키워드" /><textarea value={tag.values.map((item) => item.label === item.value ? item.label : `${item.label || ""}=${item.value || ""}`).join("\n")} onChange={(event) => updateValues(tag, event.target.value)} placeholder="키워드=저장값" /><button className="remove-button" aria-label={`${tag.name || "에셋 분류 기준"} 삭제`} onClick={() => setDeleteTarget(tag)}>×</button></article>)}</div></section>
      <section className="classification-settings"><div className="settings-heading"><h2>표시 영역</h2></div><p>저장 규칙에 포함된 각 기준을 표시할 영역을 선택하세요.</p><div className="classification-area-options">{ruleTags.map((tag) => { const area = sidebarTagIds.includes(tag.id) ? "sidebar" : topbarTagIds.includes(tag.id) ? "topbar" : "card"; return <article className="classification-area-row" key={tag.id}><span className="classification-area-meta"><strong>{tag.name}</strong><small>{tag.values.length}개 값</small></span><div className="classification-area-choices" role="radiogroup" aria-label={`${tag.name} 표시 영역`}>{[["sidebar", "사이드바"], ["topbar", "상단바"], ["card", "카드"]].map(([value, label]) => <button type="button" role="radio" aria-checked={area === value} className={area === value ? "active" : ""} key={value} onClick={() => setTagArea(tag.id, value)}>{label}</button>)}</div></article>; })}</div><div className="classification-view-summary"><span>현재 배치</span><strong>사이드바 {sidebarTags.length} · 상단바 {topbarTags.length} · 카드 {cardTags.length}</strong><small>카드 {cardCount.toLocaleString()}개</small></div></section>
    </div>
    <aside className="settings-side-column"><section className="rule-card"><div className="rule-heading"><h2>에셋 저장 규칙</h2></div><div className="rule-text-field"><input ref={ruleInput} value={ruleText} onChange={(event) => setRuleText(event.target.value)} spellCheck="false" /><span>.확장자</span></div><div className="token-list">{draft.tags.map((tag) => tag.name && <button key={tag.id} onClick={() => insertRuleText(`{${tag.name}}`)}>{tag.name}</button>)}</div>{message && <p className={message === "저장됨" || message.endsWith("갱신됨") ? "success" : "error"}>{message}</p>}<button className="primary-button full" disabled={saving || !draft.savePath} onClick={save}>{saving ? "저장 중" : project.savePath ? "설정 저장" : "에셋 활성화"}</button></section><section className="progress-launch-card"><h2>에셋 작업률</h2><button className="outline-button full" disabled={!project.savePath} onClick={() => setShowProgressModal(true)}>에셋 작업률 확인</button>{showProgressModal && <div className="modal-backdrop progress-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowProgressModal(false)}><section className="modal progress-modal"><div className="modal-heading"><h2>에셋 작업률</h2><button className="modal-close" onClick={() => setShowProgressModal(false)}>×</button></div><div className="progress-modal-content"><Progress project={project} refreshVersion={refreshVersion} /></div></section></div>}</section><section className="progress-launch-card"><h2>외부 변경 추적</h2><button className="outline-button full" disabled={syncingExternal || saving || !project.savePath || draft.savePath !== project.savePath} onClick={() => setShowSyncModal(true)}>{syncingExternal ? "갱신 중" : "외부 변경 추적 갱신"}</button>{draft.savePath !== project.savePath && <p>변경한 에셋 위치를 먼저 저장해 주세요.</p>}</section></aside>
  </div>{deleteTarget && <DeleteConfirmModal title="에셋 분류 기준 삭제" target={deleteTarget.name || "이름 없는 에셋 분류 기준"} onClose={() => setDeleteTarget(null)} onConfirm={confirmTagDelete} />}</>;
}

export { AssetSettings };
