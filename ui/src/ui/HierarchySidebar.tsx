// 하이어라키 사이드바. 프로젝트 이름 아래에 에이전트 칸(터미널 목록)과 파일 칸을 위아래로 둔다.
import { useState, type ReactNode } from "react";

interface Props {
  projectName: string;
  /** 에이전트 칸의 내용 */
  agents: ReactNode;
  /** 에이전트 칸 제목 옆에 두는 버튼들 */
  agentTools: ReactNode;
  /** 파일 칸의 내용 */
  children: ReactNode;
}

interface PaneProps {
  title: string;
  collapsed: boolean;
  onToggle(): void;
  /** 제목 오른쪽에 두는 버튼들 */
  tools?: ReactNode;
  children: ReactNode;
}

function Pane({ title, collapsed, onToggle, tools, children }: PaneProps) {
  return (
    <section className={collapsed ? "pane pane--collapsed" : "pane"} aria-label={`${title} 칸`}>
      <div className="pane__head">
        <button className="pane__title" aria-expanded={!collapsed} onClick={onToggle}>
          <span className="pane__twisty" aria-hidden="true">
            {collapsed ? "▸" : "▾"}
          </span>
          {title}
        </button>
        {tools}
      </div>
      {!collapsed && <div className="pane__body">{children}</div>}
    </section>
  );
}

export function HierarchySidebar({ projectName, agents, agentTools, children }: Props) {
  const [agentsCollapsed, setAgentsCollapsed] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(false);

  return (
    <aside className="sidebar" aria-label="하이어라키">
      <p className="sidebar__project">
        <span className="sidebar__mark" aria-hidden="true" />
        <span className="sidebar__name">{projectName}</span>
      </p>
      <Pane
        title="에이전트"
        collapsed={agentsCollapsed}
        onToggle={() => setAgentsCollapsed(!agentsCollapsed)}
        tools={agentTools}
      >
        {agents}
      </Pane>
      <Pane title="파일" collapsed={filesCollapsed} onToggle={() => setFilesCollapsed(!filesCollapsed)}>
        {children}
      </Pane>
    </aside>
  );
}
