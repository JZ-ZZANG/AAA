import { useEffect, useMemo, useRef, useState } from "react";
import { combinations, renderPath, withoutExtension } from "../shared.js";

function Progress({ project, refreshVersion }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    window.aaa.assets.list(project.id).then(setAssets).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, [project.id, refreshVersion]);

  const progress = useMemo(() => {
    if (!project.tags.length || !project.pathTemplate) return null;
    const pathSegments = project.pathTemplate.split(/[\\/]/);
    const firstFolderTemplate = pathSegments.length > 1 ? pathSegments[0] : "";
    const primaryTags = project.tags.filter((tag) => firstFolderTemplate.includes(`{tag:${tag.id}}`));
    const assetByPath = new Map();
    assets.forEach((asset) => {
      const key = withoutExtension(asset.relativePath);
      const current = assetByPath.get(key);
      if (!current || ["auto", "manual"].includes(asset.reviewStatus)) assetByPath.set(key, asset);
    });
    const allRows = combinations(project.tags).map((row) => {
      const relativePath = renderPath(project, row.selections);
      const pathParts = relativePath.split("\\");
      const label = (primaryTags.length && pathParts.length > 1 ? pathParts.slice(1) : pathParts).join("\\");
      return { ...row, relativePath, key: withoutExtension(relativePath), label };
    });
    const groups = primaryTags.length ? combinations(primaryTags).map((row) => ({ name: row.labels.join(" · "), selections: row.selections, valueId: Object.values(row.selections).join(":") })) : [{ name: project.name, selections: {}, valueId: null }];
    const results = groups.map((group) => {
      const rows = allRows.filter((row) => Object.entries(group.selections).every(([tagId, valueId]) => row.selections[tagId] === valueId));
      const uniqueRows = [...new Map(rows.map((row) => [row.key, row])).values()];
      const incomplete = uniqueRows.flatMap((row) => {
        const asset = assetByPath.get(row.key);
        if (!asset) return [{ ...row, state: "unclassified" }];
        if (project.censorshipConfig.enabled && !["auto", "manual"].includes(asset.reviewStatus)) return [{ ...row, state: "uncensored" }];
        return [];
      });
      return { ...group, total: uniqueRows.length, complete: uniqueRows.length - incomplete.length, incomplete };
    });
    const total = results.reduce((sum, group) => sum + group.total, 0);
    const classified = allRows.filter((row, index, rows) => rows.findIndex((item) => item.key === row.key) === index && assetByPath.has(row.key)).length;
    const censored = [...assetByPath.entries()].filter(([key, asset]) => allRows.some((row) => row.key === key) && ["auto", "manual"].includes(asset.reviewStatus)).length;
    const complete = project.censorshipConfig.enabled ? classified + censored : classified;
    const overallTotal = project.censorshipConfig.enabled ? total * 2 : total;
    return { total, overallTotal, complete, classified, censored, groups: results, primaryName: primaryTags.map((tag) => tag.name).join(" · ") || "프로젝트" };
  }, [assets, project]);

  if (loading) return <div className="empty-state">불러오는 중</div>;
  if (error) return <div className="empty-state">{error}</div>;
  if (!progress) return <div className="empty-state">관리에서 에셋 분류 기준과 에셋 저장 규칙을 추가하세요.</div>;
  const percentage = progress.overallTotal ? Math.round(progress.complete / progress.overallTotal * 100) : 0;
  const classificationPercentage = progress.total ? Math.round(progress.classified / progress.total * 100) : 0;
  const censorshipPercentage = progress.total ? Math.round(progress.censored / progress.total * 100) : 0;

  return <div className="progress-page">
    <section className="progress-summary"><div className="progress-number"><strong>{percentage}%</strong><span>전체 진행률</span></div><div><div className="progress-track"><div className="progress-fill" style={{ width: `${percentage}%` }} /></div><p>{progress.complete} / {progress.overallTotal}</p></div><div className="progress-breakdown"><article><header><span>분류 진행률</span><strong>{classificationPercentage}%</strong></header><div className="progress-track small"><div className="progress-fill classification" style={{ width: `${classificationPercentage}%` }} /></div><p>{progress.classified} / {progress.total}</p></article><article className={!project.censorshipConfig.enabled ? "disabled" : ""}><header><span>검열 진행률</span><strong>{project.censorshipConfig.enabled ? `${censorshipPercentage}%` : "비활성화"}</strong></header><div className="progress-track small"><div className="progress-fill censorship" style={{ width: project.censorshipConfig.enabled ? `${censorshipPercentage}%` : "0%" }} /></div><p>{project.censorshipConfig.enabled ? `${progress.censored} / ${progress.total}` : "전체 진행률에서 제외"}</p></article></div></section>
    <section className="progress-groups">{progress.groups.map((group) => {
      const groupPercentage = group.total ? Math.round(group.complete / group.total * 100) : 0;
      return <article className="progress-group" key={group.valueId || "project"}><header><div><small>{progress.primaryName}</small><h2>{group.name}</h2></div><strong>{group.complete} / {group.total}</strong></header><div className="progress-track small"><div className="progress-fill" style={{ width: `${groupPercentage}%` }} /></div>{group.incomplete.length ? <ul>{group.incomplete.map((item) => <li className={item.state} key={item.key}>{item.label}</li>)}</ul> : <p className="complete-label">완료</p>}</article>;
    })}</section>
  </div>;
}

export { Progress };
