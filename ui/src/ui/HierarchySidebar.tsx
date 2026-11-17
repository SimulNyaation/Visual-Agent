// 하이어라키 사이드바. 프로젝트 이름 아래에 에이전트 칸(터미널 목록)과 파일 칸을 위아래로 둔다.
// 두 칸 사이의 경계를 끌어 높이의 비율을 바꾼다.
import { useState, type ReactNode } from "react";
import { Splitter } from "./Splitter";

interface Props {
  projectName: string;
  /** 사이드바 너비 (px) */
  width: number;
  /** 두 칸의 높이 가운데 에이전트 칸의 몫 (0~1) */
  agentShare: number;
  /** 칸 경계를 끄는 동안. panesHeight는 두 칸의 높이를 더한 값 */
  onResizePanes(share: number, panesHeight: number): void;
  onResizePanesEnd(): void;
  onNudgePanes(direction: number, panesHeight: number): void;
  onResetPanes(): void;
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
  /** 펼쳐져 있을 때 남는 높이를 나눠 갖는 몫. 다른 칸이 접혀 있으면 1 (몫의 합이 1보다 작으면 남는 높이를 다 쓰지 못한다) */
  share: number;
  onToggle(): void;
  /** 제목 오른쪽에 두는 버튼들 */
  tools?: ReactNode;
  children: ReactNode;
}

function Pane({ title, collapsed, share, onToggle, tools, children }: PaneProps) {
  return (
    <section
      className={collapsed ? "pane pane--collapsed" : "pane"}
      aria-label={`${title} 칸`}
      style={collapsed ? undefined : { flexGrow: share }}
    >
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

/** 경계의 위 칸과 아래 칸의 자리를 잰다 */
function measure(splitter: HTMLElement) {
  const above = splitter.previousElementSibling?.getBoundingClientRect();
  const below = splitter.nextElementSibling?.getBoundingClientRect();
  if (!above || !below) return undefined;
  return { top: above.top, height: above.height + below.height };
}

export function HierarchySidebar({
  projectName,
  width,
  agentShare,
  onResizePanes,
  onResizePanesEnd,
  onNudgePanes,
  onResetPanes,
  agents,
  agentTools,
  children,
}: Props) {
  const [agentsCollapsed, setAgentsCollapsed] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(false);

  return (
    <aside className="sidebar" aria-label="하이어라키" style={{ width }}>
      <p className="sidebar__project">
        <span className="sidebar__mark" aria-hidden="true" />
        <span className="sidebar__name">{projectName}</span>
      </p>
      <Pane
        title="에이전트"
        collapsed={agentsCollapsed}
        share={filesCollapsed ? 1 : agentShare}
        onToggle={() => setAgentsCollapsed(!agentsCollapsed)}
        tools={agentTools}
      >
        {agents}
      </Pane>
      {/* 한 칸이 접혀 있으면 다른 칸이 남는 자리를 모두 쓰므로 경계를 두지 않는다 */}
      {!agentsCollapsed && !filesCollapsed && (
        <Splitter
          orientation="horizontal"
          label="에이전트 칸과 파일 칸의 높이 조절"
          value={Math.round(agentShare * 100)}
          onDrag={(position, element) => {
            const panes = measure(element);
            if (panes && panes.height > 0) onResizePanes((position - panes.top) / panes.height, panes.height);
          }}
          onDragEnd={onResizePanesEnd}
          onNudge={(direction, element) => {
            const panes = measure(element);
            if (panes) onNudgePanes(direction, panes.height);
          }}
          onReset={onResetPanes}
        />
      )}
      <Pane
        title="파일"
        collapsed={filesCollapsed}
        share={agentsCollapsed ? 1 : 1 - agentShare}
        onToggle={() => setFilesCollapsed(!filesCollapsed)}
      >
        {children}
      </Pane>
    </aside>
  );
}
