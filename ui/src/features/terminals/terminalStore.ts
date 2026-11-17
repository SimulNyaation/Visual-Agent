// 터미널의 현재 상태(어떤 터미널이 떠 있고 어느 것을 보고 있는지)를 들고 있고, 바뀌면 화면에 알린다.
// 터미널마다 글자 화면을 하나씩 만들어 두고, 보이지 않는 동안에도 코어에서 온 출력을 그 화면에 적어 둔다.
import type { TerminalsApi } from "../../data/apiClient";
import { activeTab } from "../../domain/projectTabs";
import {
  terminalErrorMessage,
  type CloseQuestion,
  type ScreenFactory,
  type TerminalEvents,
  type TerminalInfo,
  type TerminalScreen,
} from "../../domain/terminals";
import type { ProjectTabsStore } from "../projectTabs/projectTabsStore";

export interface TerminalSnapshot {
  /** 지금 보고 있는 프로젝트 탭의 터미널들 */
  terminals: TerminalInfo[];
  /** 작업 영역에 보이는 터미널 */
  activeId: string | null;
  screen: TerminalScreen | null;
  /** 실행 중인 프로그램이 있어 닫기 전에 묻고 있는 것 */
  question: CloseQuestion | null;
  /** 터미널을 띄우지 못한 이유 */
  error: string | null;
  /** 코어와 연결이 끊겨 터미널의 소식을 더 받지 못함 */
  disconnected: boolean;
}

export interface TerminalStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TerminalSnapshot;
  /** 지금 보고 있는 프로젝트 탭에 터미널을 하나 더 띄운다 */
  open(): Promise<void>;
  select(id: string): void;
  close(id: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  confirm(): Promise<void>;
  cancel(): Promise<void>;
}

interface InputQueue {
  pending: string;
  sending: boolean;
}

export function createTerminalStore(api: TerminalsApi, tabs: ProjectTabsStore, createScreen: ScreenFactory): TerminalStore {
  const listeners = new Set<() => void>();
  const screens = new Map<string, TerminalScreen>();
  const inputs = new Map<string, InputQueue>();
  /** 탭마다 보고 있는 터미널 */
  const activeByTab = new Map<string, string>();
  /** 방금 띄워 달라고 한 터미널. 목록에 나타나면 그 탭에서 보이게 한다 */
  const wantedByTab = new Map<string, string>();
  const errors = new Map<string, string>();

  let all: TerminalInfo[] = [];
  let tabId: string | null = null;
  let usable = false;
  let question: CloseQuestion | null = null;
  let quitSeen = 0;
  let lost = false;
  let snapshot: TerminalSnapshot = build();

  function build(): TerminalSnapshot {
    const terminals = tabId ? all.filter((terminal) => terminal.tabId === tabId) : [];
    const activeId = (tabId && activeByTab.get(tabId)) ?? null;
    return {
      terminals,
      activeId,
      screen: activeId ? screenOf(activeId) : null,
      question,
      error: (tabId && errors.get(tabId)) ?? null,
      disconnected: lost,
    };
  }

  function publish() {
    snapshot = build();
    listeners.forEach((listener) => listener());
  }

  /** 입력은 한 번에 하나씩 차례로 보낸다. 여러 요청이 동시에 가면 글자 순서가 뒤바뀔 수 있다 */
  function sendInput(id: string, data: string) {
    let queue = inputs.get(id);
    if (!queue) {
      queue = { pending: "", sending: false };
      inputs.set(id, queue);
    }
    queue.pending += data;
    if (queue.sending) return;
    const current = queue;
    current.sending = true;
    void (async () => {
      while (current.pending !== "") {
        const next = current.pending;
        current.pending = "";
        try {
          await api.sendInput(id, next);
        } catch {
          break;
        }
      }
      current.sending = false;
    })();
  }

  function screenOf(id: string): TerminalScreen {
    let screen = screens.get(id);
    if (!screen) {
      screen = createScreen({
        onInput: (data) => sendInput(id, data),
        onResize: (columns, rows) => void api.resizeTerminal(id, columns, rows).catch(() => undefined),
      });
      screens.set(id, screen);
    }
    return screen;
  }

  function apply(events: TerminalEvents) {
    for (const chunk of events.output) screenOf(chunk.id).write(chunk.bytes);

    all = events.terminals;
    const alive = new Set(all.map((terminal) => terminal.id));
    for (const [id, screen] of screens) {
      if (alive.has(id)) continue;
      screen.dispose();
      screens.delete(id);
      inputs.delete(id);
    }

    for (const [tab, id] of wantedByTab) {
      if (!alive.has(id)) continue;
      activeByTab.set(tab, id);
      wantedByTab.delete(tab);
    }
    // 보고 있던 터미널이 닫혔으면 그 탭의 마지막 터미널을 보인다
    for (const [tab, id] of activeByTab) {
      if (alive.has(id)) continue;
      const last = all.filter((terminal) => terminal.tabId === tab).pop();
      if (last) activeByTab.set(tab, last.id);
      else activeByTab.delete(tab);
    }
    for (const terminal of all) {
      if (!activeByTab.has(terminal.tabId)) activeByTab.set(terminal.tabId, terminal.id);
    }

    if (events.quitRequests > quitSeen) {
      quitSeen = events.quitRequests;
      question = { kind: "app" };
    }
    publish();
  }

  async function listen() {
    let version = 0;
    for (;;) {
      let events: TerminalEvents;
      try {
        events = await api.waitForTerminalEvents(version);
      } catch {
        lost = true;
        publish();
        return;
      }
      version = events.version;
      apply(events);
    }
  }

  async function start(tab: string, automatic: boolean) {
    try {
      const result = await api.openTerminal(tab, automatic);
      if (result.ok) {
        errors.delete(tab);
        if (result.terminal) wantedByTab.set(tab, result.terminal.id);
      } else {
        const message = terminalErrorMessage(result.error);
        if (message) errors.set(tab, message);
      }
    } catch {
      lost = true;
    }
    publish();
  }

  function syncActiveTab() {
    const { state } = tabs.getSnapshot();
    for (const known of [...errors.keys()]) {
      if (!state.tabs.some((tab) => tab.id === known)) errors.delete(known);
    }
    const tab = activeTab(state);
    const nextId = tab?.id ?? null;
    const nextUsable = tab !== undefined && !tab.missing;
    if (nextId === tabId && nextUsable === usable) return;

    tabId = nextId;
    usable = nextUsable;
    publish();
    // 그 탭을 처음 볼 때 터미널 하나를 띄운다. 이미 띄워 준 탭이면 코어가 다시 띄우지 않는다
    if (nextId && nextUsable) void start(nextId, true);
  }

  tabs.subscribe(syncActiveTab);
  syncActiveTab();
  void listen();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,

    async open() {
      if (tabId && usable) await start(tabId, false);
    },

    select(id) {
      const terminal = all.find((candidate) => candidate.id === id);
      if (!terminal) return;
      activeByTab.set(terminal.tabId, id);
      publish();
    },

    async close(id) {
      try {
        const result = await api.closeTerminal(id, false);
        if (!result.ok && result.error === "busy") {
          question = { kind: "terminal", id };
          publish();
        }
      } catch {
        lost = true;
        publish();
      }
    },

    async closeTab(target) {
      if ((await tabs.closeTab(target, false)) === "busy") {
        question = { kind: "tab", tabId: target };
        publish();
      }
    },

    async confirm() {
      const asked = question;
      question = null;
      publish();
      if (!asked) return;
      try {
        if (asked.kind === "terminal") await api.closeTerminal(asked.id, true);
        else if (asked.kind === "tab") await tabs.closeTab(asked.tabId, true);
        else await api.answerQuit(true);
      } catch {
        lost = true;
        publish();
      }
    },

    async cancel() {
      const asked = question;
      question = null;
      publish();
      if (asked?.kind === "app") await api.answerQuit(false).catch(() => undefined);
    },
  };
}
