// 화면 배치(사이드바 너비, 두 칸의 높이 비율)를 들고 있고, 바뀌면 화면에 알린다. 끌기가 끝나면 코어에 기억시킨다.
import type { LayoutApi } from "../../data/apiClient";
import { clampAgentShare, clampSidebarWidth, defaultLayout, nudgeStep, type Layout } from "../../domain/layout";

export interface LayoutStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Layout;
  /** 코어가 기억하고 있는 배치를 읽어 온다 */
  load(): Promise<void>;
  /** 사이드바 너비를 바꾼다. 한계를 벗어나면 한계에서 멈춘다 */
  resizeSidebar(width: number, windowWidth: number): void;
  /** 에이전트 칸의 몫을 바꾼다. panesHeight는 두 칸의 높이를 더한 값 */
  resizePanes(share: number, panesHeight: number): void;
  /** 방향키로 조금씩 움직인다. direction은 -1(왼쪽·위) 또는 1(오른쪽·아래) */
  nudgeSidebar(direction: number, windowWidth: number): void;
  nudgePanes(direction: number, panesHeight: number): void;
  /** 처음 값으로 되돌린다 */
  resetSidebar(): void;
  resetPanes(): void;
  /** 지금 배치를 코어에 기억시킨다 */
  save(): Promise<void>;
}

export function createLayoutStore(api: LayoutApi): LayoutStore {
  const listeners = new Set<() => void>();
  let layout: Layout = defaultLayout;

  function change(next: Layout) {
    if (next.sidebarWidth === layout.sidebarWidth && next.agentShare === layout.agentShare) return;
    layout = next;
    listeners.forEach((listener) => listener());
  }

  async function save() {
    // 기억시키지 못해도 화면은 그대로 쓴다. 다음에 켰을 때 이전 값으로 뜰 뿐이다
    await api.saveLayout(layout).catch(() => undefined);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => layout,

    async load() {
      try {
        change(await api.fetchLayout());
      } catch {
        // 읽지 못하면 처음 값으로 둔다
      }
    },

    resizeSidebar(width, windowWidth) {
      change({ ...layout, sidebarWidth: clampSidebarWidth(width, windowWidth) });
    },
    resizePanes(share, panesHeight) {
      change({ ...layout, agentShare: clampAgentShare(share, panesHeight) });
    },
    nudgeSidebar(direction, windowWidth) {
      change({ ...layout, sidebarWidth: clampSidebarWidth(layout.sidebarWidth + direction * nudgeStep, windowWidth) });
      void save();
    },
    nudgePanes(direction, panesHeight) {
      if (!(panesHeight > 0)) return;
      change({ ...layout, agentShare: clampAgentShare(layout.agentShare + (direction * nudgeStep) / panesHeight, panesHeight) });
      void save();
    },
    resetSidebar() {
      change({ ...layout, sidebarWidth: defaultLayout.sidebarWidth });
      void save();
    },
    resetPanes() {
      change({ ...layout, agentShare: defaultLayout.agentShare });
      void save();
    },
    save,
  };
}
