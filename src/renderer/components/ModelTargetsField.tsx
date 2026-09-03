import { useEffect, useState } from "react";
import { CENSOR_TARGET_OPTIONS, formatCensorTargets, parseCensorTargets } from "../shared";

function sameTargets(left, right) {
  return left.length === right.length && left.every((target, index) => target === right[index]);
}

function ModelTargetsField({ modelPath = "", targets = [], onChange, disabled = false, className = "" }) {
  const [text, setText] = useState(() => formatCensorTargets(targets));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingModel, setPendingModel] = useState(null);
  const targetKey = JSON.stringify(targets || []);
  const normalizedModelPath = String(modelPath || "").trim();

  useEffect(() => {
    const nextTargets = Array.isArray(targets) ? targets.map((target) => String(target).trim()).filter(Boolean) : [];
    if (!sameTargets(parseCensorTargets(text), nextTargets)) setText(formatCensorTargets(nextTargets));
  }, [targetKey]);

  const updateText = (value) => {
    setText(value);
    onChange(parseCensorTargets(value));
    setError("");
  };

  const inspectModel = async () => {
    if (!normalizedModelPath || loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await window.aaa.aiRuntime.inspectModel(normalizedModelPath);
      const classes = [...new Set((result?.classes || []).map((item) => String(item?.name || "").trim()).filter(Boolean))];
      if (!classes.length) throw new Error("모델에서 학습 클래스 정보를 찾지 못했습니다.");
      setPendingModel({ ...result, classes });
    } catch (reason) {
      setError(reason?.message || "모델의 학습 클래스를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const applyModelClasses = () => {
    const classes = pendingModel?.classes || [];
    setText(formatCensorTargets(classes));
    onChange(classes);
    setPendingModel(null);
    setError("");
  };

  const addPresetTarget = (target) => {
    const currentTargets = parseCensorTargets(text);
    if (currentTargets.some((item) => item.toLowerCase() === target.toLowerCase())) return;
    const nextTargets = [...currentTargets, target];
    setText(formatCensorTargets(nextTargets));
    onChange(nextTargets);
    setError("");
  };

  return <>
    <div className={`model-targets-field ${className}`.trim()}>
      <span>검열 대상</span>
      <div className="model-targets-controls">
        <input
          aria-label="검열 대상"
          disabled={disabled}
          value={text}
          placeholder="클래스 이름을 쉼표로 구분해 입력"
          onChange={(event) => updateText(event.target.value)}
          onBlur={() => setText(formatCensorTargets(parseCensorTargets(text)))}
        />
        <button type="button" className="outline-button" disabled={disabled || loading || !normalizedModelPath} onClick={inspectModel}>
          {loading ? "불러오는 중…" : "모델 클래스 불러오기"}
        </button>
      </div>
      <div className="target-options model-target-presets" aria-label="기본 검열 대상 빠른 추가">
        {CENSOR_TARGET_OPTIONS.map(([value, label]) => {
          const added = parseCensorTargets(text).some((target) => target.toLowerCase() === value.toLowerCase());
          return <button type="button" className={added ? "active" : ""} disabled={disabled || added} aria-label={`${label} (${value}) 추가`} key={value} onClick={() => addPresetTarget(value)}>{label}</button>;
        })}
      </div>
      <small>여러 대상은 쉼표로 구분합니다.</small>
      {error && <small className="error">{error}</small>}
    </div>
    {pendingModel && <div className="modal-backdrop model-classes-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingModel(null); }}>
      <section className="modal model-classes-modal" role="dialog" aria-modal="true" aria-labelledby="model-classes-title">
        <div className="modal-heading"><h2 id="model-classes-title">검열 대상 변경</h2><button type="button" className="modal-close" onClick={() => setPendingModel(null)}>×</button></div>
        <p><strong>{pendingModel.model}</strong>에서 학습 클래스 {pendingModel.classes.length}개를 찾았습니다.</p>
        <div className="model-classes-preview">{pendingModel.classes.map((name) => <span key={name}>{name}</span>)}</div>
        <p>현재 검열 대상을 위의 모델 학습 클래스로 바꿀까요?</p>
        <div className="modal-actions"><button type="button" className="text-button" onClick={() => setPendingModel(null)}>취소</button><button type="button" className="primary-button" onClick={applyModelClasses}>변경</button></div>
      </section>
    </div>}
  </>;
}

export { ModelTargetsField };
