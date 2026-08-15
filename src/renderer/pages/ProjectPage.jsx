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
  useEffect(() => {
    const shortcuts = savedShortcuts();
    const tabShortcuts = [
      ["management", "settings"],
      ["work", "work"],
      ["prompts", "prompts"],
      ["lorebook", "lorebook"],
      ["situation", "situation"],
      ["classification", "classification"],
      ["censorship", "censorship"],
      ["export", "export"]
    ];
    const listener = (event) => {
      if (suspended || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      if (matchesShortcut(event, shortcuts.home)) {
        event.preventDefault();
        onBack();
        return;
      }
      const match = tabShortcuts.find(([key]) => matchesShortcut(event, shortcuts[key]));
      if (!match) return;
      event.preventDefault();
      if (match[1] !== "censorship" || project.censorshipConfig.enabled) setTab(match[1]);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [project.censorshipConfig.enabled, onBack, suspended]);
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
