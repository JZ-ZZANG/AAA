import { Clapperboard, LibraryBig, ShieldCheck, Trash2 } from "lucide-react";

function Home({ projects, loading, onCreate, onOpen, onDelete, onTemplates, onGifMaker, onStandaloneAi }) {
  return (
    <main className="page home-page">
      <section className="home-section home-project-section">
        <header className="home-heading">
          <h1>프로젝트</h1>
          <button className="primary-button" onClick={onCreate}>＋ 프로젝트 생성</button>
        </header>
        {loading ? (
          <div className="empty-state">불러오는 중</div>
        ) : projects.length ? (
          <div className="project-list">
            {projects.map((project) => (
              <article className="project-card" key={project.id}>
                <button className="project-open" onClick={() => onOpen(project.id)}>
                  <div className={`project-thumbnail ${project.titleImage ? "has-image" : ""}`}>{project.titleImage && <img src={`aaa-asset://${project.titleImage.id}?v=${encodeURIComponent(project.titleImage.createdAt)}`} alt="" />}</div>
                  <div className="project-card-info"><strong>{project.name}</strong></div>
                </button>
                <button
                  className="project-delete"
                  aria-label={`${project.name} 삭제`}
                  title="프로젝트 삭제"
                  onClick={() => onDelete(project)}
                >
                  <Trash2 size={17} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">프로젝트가 없습니다.</div>
        )}
      </section>
      <section className="home-section home-tool-section">
        <header className="home-heading"><h2>제작 도구</h2></header>
        <div className="home-tool-list">
          <button className="home-tool-card" onClick={onTemplates}><LibraryBig size={25} /><strong>템플릿 설정</strong></button>
          <button className="home-tool-card" onClick={onGifMaker}><Clapperboard size={25} /><strong>움짤 생성</strong></button>
          {/* <button className="home-tool-card" onClick={onStandaloneAi}><ShieldCheck size={25} /><strong>에셋 AI 검열</strong></button> */}
        </div>
      </section>
    </main>
  );
}

export { Home };
