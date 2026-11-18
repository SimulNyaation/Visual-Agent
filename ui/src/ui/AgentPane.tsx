// 에이전트 칸. 터미널마다 한 줄씩 보여 주고, 그 터미널에서 에이전트가 돌고 있으면 이름을 함께 보여 준다.
import { terminalLabel, type TerminalRow } from "../domain/terminals";

interface PaneProps {
  terminals: TerminalRow[];
  activeId: string | null;
  onSelect(id: string): void;
  onClose(id: string): void;
}

export function AgentPane({ terminals, activeId, onSelect, onClose }: PaneProps) {
  if (terminals.length === 0) return <p className="pane__empty">터미널이 없습니다</p>;

  return (
    <ul className="agents" aria-label="터미널 목록">
      {terminals.map((terminal) => {
        const selected = terminal.id === activeId;
        return (
          <li key={terminal.id} className={selected ? "agentrow agentrow--selected" : "agentrow"}>
            <button
              type="button"
              className="agentrow__select"
              aria-label={terminalLabel(terminal)}
              aria-current={selected}
              title={terminal.title ?? undefined}
              onClick={() => onSelect(terminal.id)}
            >
              <span className={terminal.agent ? "agentrow__dot agentrow__dot--running" : "agentrow__dot"} aria-hidden="true" />
              {terminal.title ? (
                <span className="agentrow__titled">
                  <span className="agentrow__title">{terminal.title}</span>
                  <span className="agentrow__meta">
                    {terminal.agent} · {terminal.name}
                  </span>
                </span>
              ) : terminal.agent ? (
                <>
                  <span className="agentrow__agent">{terminal.agent}</span>
                  <span className="agentrow__shell">{terminal.name}</span>
                </>
              ) : (
                <span className="agentrow__name">{terminal.name}</span>
              )}
            </button>
            <button
              type="button"
              className="agentrow__close"
              aria-label={`${terminal.name} 닫기`}
              onClick={() => onClose(terminal.id)}
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 에이전트 칸 제목 옆의 새 터미널(+) */
export function AgentTools({ onNew }: { onNew(): void }) {
  return (
    <div className="panetools">
      <button type="button" className="panetools__button" aria-label="새 터미널" title="새 터미널" onClick={onNew}>
        +
      </button>
    </div>
  );
}
