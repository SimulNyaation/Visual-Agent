// 하이어라키 사이드바. 지금은 프로젝트 이름만 보여준다.
interface Props {
  projectName: string;
}

export function HierarchySidebar({ projectName }: Props) {
  return (
    <aside className="sidebar" aria-label="하이어라키">
      <p className="sidebar__project">
        <span className="sidebar__mark" aria-hidden="true" />
        <span className="sidebar__name">{projectName}</span>
      </p>
    </aside>
  );
}
