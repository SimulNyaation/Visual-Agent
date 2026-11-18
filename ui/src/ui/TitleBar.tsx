// 제목 표시줄. 프로젝트 탭 줄과 프로젝트 추가(+)가 들어 있고, 빈 곳을 끌면 창이 움직인다.
import type { CSSProperties, WheelEvent } from "react";
import type { ProjectTab } from "../domain/projectTabs";

interface Props {
  tabs: ProjectTab[];
  activeId: string;
  captionWidth: number;
  /** 확인하지 않은 "끝남"이 있는 프로젝트 탭들 */
  attention?: string[];
  /** 보고 있지 않은 터미널의 에이전트가 허락을 기다리고 있는 프로젝트 탭들 */
  asking?: string[];
  onSelect(id: string): void;
  onClose(id: string): void;
  onAdd(): void;
}

function scrollSideways(event: WheelEvent<HTMLDivElement>) {
  event.currentTarget.scrollLeft += event.deltaY + event.deltaX;
}

function revealTab(element: HTMLDivElement | null) {
  element?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function TitleBar({ tabs, activeId, captionWidth, attention = [], asking = [], onSelect, onClose, onAdd }: Props) {
  const style = { "--caption-width": `${captionWidth}px` } as CSSProperties;
  return (
    <header className="titlebar" style={style}>
      <div className="tabstrip" role="tablist" aria-label="프로젝트" onWheel={scrollSideways}>
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          const waitsForMe = asking.includes(tab.id);
          const finished = attention.includes(tab.id);
          const note = waitsForMe ? "허락을 기다리는 에이전트가 있습니다" : finished ? "작업을 마친 에이전트가 있습니다" : undefined;
          return (
            <div
              key={tab.id}
              className={selected ? "tab tab--selected" : "tab"}
              ref={selected ? revealTab : undefined}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                className="tab__select"
                title={tab.path}
                aria-description={note}
                onClick={() => onSelect(tab.id)}
              >
                {note && <span className="tab__attention" aria-hidden="true" />}
                {tab.missing && <span className="tab__missing" aria-hidden="true" />}
                <span className="tab__label">{tab.label}</span>
              </button>
              <button
                type="button"
                className="tab__close"
                aria-label={`${tab.label} 탭 닫기`}
                onClick={() => onClose(tab.id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="titlebar__add" aria-label="프로젝트 추가" onClick={onAdd}>
        +
      </button>
    </header>
  );
}
