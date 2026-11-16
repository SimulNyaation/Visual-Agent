// 하이어라키 사이드바. 프로젝트 이름 아래에 에이전트 칸과 파일 칸을 위아래로 둔다.
import { useState, type ReactNode } from "react";

interface Props {
  projectName: string;
  /** 파일 칸의 내용 */
  children: ReactNode;
}

interface PaneProps {
  title: string;
  collapsed: boolean;
  onToggle(): void;
  children: ReactNode;
}

function Pane({ title, collapsed, onToggle, children }: PaneProps) {
  return (
    <section className={collapsed ? "pane pane--collapsed" : "pane"} aria-label={`${title} 칸`}>
      <button className="pane__title" aria-expanded={!collapsed} onClick={onToggle}>
        <span className="pane__twisty" aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
        {title}
      </button>
      {!collapsed && <div className="pane__body">{children}</div>}
    </section>
  );
}

export function HierarchySidebar({ projectName, children }: Props) {
  const [agentsCollapsed, setAgentsCollapsed] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(false);

  return (
    <aside className="sidebar" aria-label="하이어라키">
      <p className="sidebar__project">
        <span className="sidebar__mark" aria-hidden="true" />
        <span className="sidebar__name">{projectName}</span>
      </p>
      <Pane title="에이전트" collapsed={agentsCollapsed} onToggle={() => setAgentsCollapsed(!agentsCollapsed)}>
        <p className="pane__empty">에이전트가 없습니다</p>
      </Pane>
      <Pane title="파일" collapsed={filesCollapsed} onToggle={() => setFilesCollapsed(!filesCollapsed)}>
        {children}
      </Pane>
    </aside>
  );
}
