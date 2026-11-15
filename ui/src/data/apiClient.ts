// 코어와 주고받는 유일한 통로. 주소는 모두 여기에만 적는다.
import { parseProjectTabsState, type ProjectTabsState } from "../domain/projectTabs";

export interface ProjectTabsApi {
  fetchState(): Promise<ProjectTabsState>;
  /** 폴더 선택 창을 띄워 고른 폴더를 탭으로 연다. 취소하면 탭은 그대로다 */
  addProject(): Promise<ProjectTabsState>;
  selectTab(id: string): Promise<ProjectTabsState>;
  closeTab(id: string): Promise<ProjectTabsState>;
}

const paths = {
  state: "/api/state",
  tabs: "/api/tabs",
  tab: (id: string) => `/api/tabs/${encodeURIComponent(id)}`,
  selectTab: (id: string) => `/api/tabs/${encodeURIComponent(id)}/select`,
};

export function createApiClient(token: string): ProjectTabsApi {
  async function request(method: string, path: string, body?: unknown): Promise<ProjectTabsState> {
    const response = await fetch(path, {
      method,
      headers: { "X-VA-Token": token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`코어 요청 실패: ${method} ${path} → ${response.status}`);
    const state = parseProjectTabsState(await response.json());
    if (!state) throw new Error(`코어 응답을 이해할 수 없습니다: ${method} ${path}`);
    return state;
  }

  return {
    fetchState: () => request("GET", paths.state),
    addProject: () => request("POST", paths.tabs, {}),
    selectTab: (id) => request("POST", paths.selectTab(id)),
    closeTab: (id) => request("DELETE", paths.tab(id)),
  };
}
