import { useEffect, useState } from "react";
import { savedShortcuts, matchesShortcut } from "../shared.js";
import { ProjectTitlebarNav } from "../components/Shell.jsx";
import { Settings } from "./Management.jsx";
import { Classification } from "./Classification.jsx";
import { Censorship } from "./Censorship.jsx";
import { Prompts } from "./Prompts.jsx";
import { Lorebooks } from "./Lorebooks.jsx";
import { Work } from "./Work.jsx";
import { ExportProject } from "./Export.jsx";

function ProjectPage({ project, onBack, onProjectChanged, classificationLayout, onClassificationLayoutChange, suspended = false }) {
  const [tab, setTab] = useState("settings");
  useEffect(() => { const shortcuts = savedShortcuts(); const listener = (event) => { if (suspended || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return; if (matchesShortcut(event, shortcuts.home)) { event.preventDefault(); onBack(); } else if (matchesShortcut(event, shortcuts.management)) { event.preventDefault(); setTab("settings"); } else if (matchesShortcut(event, shortcuts.classification)) { event.preventDefault(); setTab("classification"); } else if (project.censorshipConfig.enabled && matchesShortcut(event, shortcuts.censorship)) { event.preventDefault(); setTab("censorship"); } }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, [project.censorshipConfig.enabled, onBack, suspended]);
  let content = <Settings project={project} onSaved={onProjectChanged} />;
  if (tab === "work") content = <Work project={project} />;
  else if (tab === "classification") content = <Classification project={project} refreshVersion={0} layout={classificationLayout} onLayoutChange={onClassificationLayoutChange} />;
  else if (tab === "prompts") content = <Prompts project={project} />;
  else if (tab === "lorebook") content = <Lorebooks project={project} />;
  else if (tab === "situation") content = <Prompts project={project} kind="situation" />;
  else if (tab === "censorship" && project.censorshipConfig.enabled) content = <Censorship project={project} />;
  else if (tab === "export") content = <ExportProject project={project} />;
  return <><ProjectTitlebarNav project={project} tab={tab} onTab={setTab} onHome={onBack} /><main className="page project-page">{content}</main></>;
}

export { ProjectPage };
