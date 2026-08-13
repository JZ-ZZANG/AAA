import { useState } from "react";
import { ProjectTitlebarNav } from "../components/Shell.jsx";
import { Lorebooks } from "./Lorebooks.jsx";
import { Prompts } from "./Prompts.jsx";
import { ExportTemplateSettings } from "./ExportTemplateSettings.jsx";

const TEMPLATE_SCOPE = { id: "global-templates", savePath: "" };

function TemplateSettings({ onBack }) {
  const [tab, setTab] = useState("prompts");

  return <>
    <ProjectTitlebarNav project={TEMPLATE_SCOPE} tab={tab} onTab={setTab} onHome={onBack} templateMode />
    <main className="page project-page template-settings-page">
      {tab === "prompts" ? <Prompts project={TEMPLATE_SCOPE} api={window.aaa.promptTemplates} />
        : tab === "lorebook" ? <Lorebooks project={TEMPLATE_SCOPE} api={window.aaa.lorebookTemplates} />
          : tab === "situation" ? <Prompts project={TEMPLATE_SCOPE} kind="situation" api={window.aaa.situationTemplates} />
          : tab === "export" ? <ExportTemplateSettings />
          : <div className="template-situation-page" />}
    </main>
  </>;
}

export { TemplateSettings };
