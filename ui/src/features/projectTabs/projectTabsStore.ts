// 프로젝트 탭의 현재 상태를 들고 있고, 바뀌면 화면에 알린다.
import type { ProjectTabsApi } from "../../data/apiClient";
import { emptyProjectTabsState, type ProjectTabsState } from "../../domain/projectTabs";

export interface ProjectTabsSnapshot {
  /** loading: 코어의 첫 응답을 기다리는 중 */
  status: "loading" | "ready" | "disconnected";
  state: ProjectTabsState;
}

export interface ProjectTabsStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ProjectTabsSnapshot;
  load(): Promise<void>;
  addProject(): Promise<void>;
  selectTab(id: string): Promise<void>;
  closeTab(id: string): Promise<void>;
}

export function createProjectTabsStore(api: ProjectTabsApi): ProjectTabsStore {
  let snapshot: ProjectTabsSnapshot = { status: "loading", state: emptyProjectTabsState };
  const listeners = new Set<() => void>();

  function publish(next: ProjectTabsSnapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  async function apply(action: () => Promise<ProjectTabsState>) {
    try {
      publish({ status: "ready", state: await action() });
    } catch {
      publish({ status: "disconnected", state: snapshot.state });
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    load: () => apply(() => api.fetchState()),
    addProject: () => apply(() => api.addProject()),
    selectTab: (id) => apply(() => api.selectTab(id)),
    closeTab: (id) => apply(() => api.closeTab(id)),
  };
}
