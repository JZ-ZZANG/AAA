import { useState } from "react";
import { ProjectTitlebarNav } from "../components/Shell";
import { Lorebooks } from "./Lorebooks";
import { Prompts } from "./Prompts";

const TEMPLATE_SCOPE = { id: "global-templates", savePath: "" };

function TemplateSettings({ onBack }) {
  const [tab, setTab] = useState("prompts");

  return <>
    <ProjectTitlebarNav project={TEMPLATE_SCOPE} tab={tab} onTab={setTab} onHome={onBack} contextLabel="템플릿 설정" templateMode />
    <main className="page project-page template-settings-page">
      {tab === "prompts" ? <Prompts project={TEMPLATE_SCOPE} api={window.aaa.promptTemplates} />
        : tab === "lorebook" ? <Lorebooks project={TEMPLATE_SCOPE} api={window.aaa.lorebookTemplates} />
          : tab === "situation" ? <Prompts project={TEMPLATE_SCOPE} kind="situation" api={window.aaa.situationTemplates} />
          : <div className="template-situation-page" />}
    </main>
  </>;
}

export { TemplateSettings };
