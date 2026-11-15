// 프로젝트 탭의 모양. 코어가 보내주는 내용과 같다.

export interface ProjectTab {
  id: string;
  /** 폴더 이름 */
  name: string;
  /** 탭에 표시할 이름. 같은 이름의 폴더가 있으면 상위 폴더 이름이 붙는다 */
  label: string;
  path: string;
  /** 폴더를 찾을 수 없음 */
  missing: boolean;
}

export interface ProjectTabsState {
  tabs: ProjectTab[];
  activeId: string;
}

export const emptyProjectTabsState: ProjectTabsState = { tabs: [], activeId: "" };

export function activeTab(state: ProjectTabsState): ProjectTab | undefined {
  return state.tabs.find((tab) => tab.id === state.activeId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProjectTab(value: unknown): value is ProjectTab {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.label === "string" &&
    typeof value.path === "string" &&
    typeof value.missing === "boolean"
  );
}

/** 코어의 응답이 약속한 모양인지 확인한다. 아니면 undefined */
export function parseProjectTabsState(value: unknown): ProjectTabsState | undefined {
  if (!isRecord(value) || !Array.isArray(value.tabs) || typeof value.activeId !== "string") {
    return undefined;
  }
  if (!value.tabs.every(isProjectTab)) return undefined;
  return { tabs: value.tabs, activeId: value.activeId };
}
