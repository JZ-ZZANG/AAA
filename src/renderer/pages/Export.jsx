import { useState } from "react";
import { Download, FolderArchive } from "lucide-react";

function ExportProject({ project }) {
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);

  async function exportProject() {
    setExporting(true);
    setStatus("");
    try {
      const outputPath = await window.aaa.projects.export(project.id);
      if (outputPath) setStatus(`내보내기 완료: ${outputPath}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setExporting(false);
    }
  }

  return <div className="export-page">
    <section className="export-section">
      <div className="export-section-heading"><h2>파일로 내보내기</h2></div>
      <div className="export-list">
        <article className="export-list-item">
          <div className="export-item-icon"><FolderArchive size={22} /></div>
          <div className="export-item-content"><strong>프로젝트 ZIP</strong><span>프로젝트를 ZIP파일로 저장합니다.</span></div>
          <button className="primary-button editor-icon-button export-item-action" aria-label="다운로드" data-tooltip="다운로드" disabled={exporting} onClick={exportProject}><Download size={18} /></button>
        </article>
      </div>
      {status && <p className={`export-status ${status.startsWith("내보내기 완료") ? "success" : "error"}`}>{status}</p>}
    </section>
  </div>;
}

export { ExportProject };
