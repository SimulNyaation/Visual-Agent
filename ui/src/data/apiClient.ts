// 코어와 주고받는 유일한 통로. 주소는 모두 여기에만 적는다.
import {
  parseChanges,
  parseErrorCode,
  parseListings,
  parseUndone,
  type FileChange,
  type FolderListing,
  type UndoneOperation,
} from "../domain/fileTree";
import { parseLayout, type Layout } from "../domain/layout";
import { parseProjectTabsState, type ProjectTabsState } from "../domain/projectTabs";
import {
  parseOpened,
  parseTerminalEvents,
  type TerminalEvents,
  type TerminalInfo,
} from "../domain/terminals";

export interface ProjectTabsApi {
  fetchState(): Promise<ProjectTabsState>;
  /** 폴더 선택 창을 띄워 고른 폴더를 탭으로 연다. 취소하면 탭은 그대로다 */
  addProject(): Promise<ProjectTabsState>;
  selectTab(id: string): Promise<ProjectTabsState>;
  /** 터미널에서 실행 중인 프로그램이 있으면 닫지 않고 busy로 거절한다. force면 묻지 않고 닫는다 */
  closeTab(id: string, force: boolean): Promise<CloseTabResult>;
}

/** 코어가 거절한 이유. 연결이 끊긴 경우는 이것이 아니라 예외로 알린다 */
export interface Refused {
  ok: false;
  error: string;
}
export type CloseTabResult = { ok: true; state: ProjectTabsState } | Refused;
export type OpenTerminalResult = { ok: true; terminal: TerminalInfo | null } | Refused;
export type CloseTerminalResult = { ok: true } | Refused;
export type ListResult = { ok: true; dirs: FolderListing[] } | Refused;
export type FileResult = { ok: true; changes: FileChange[] } | Refused;
export type UndoResult = { ok: true; undone: UndoneOperation } | Refused;

export interface KnownFolder {
  path: string;
  stamp: string;
}

export interface FilesApi {
  list(tabId: string, dirs: string[]): Promise<ListResult>;
  /** 알고 있는 내용과 달라진 폴더가 생길 때까지 기다린다. 한동안 변화가 없으면 빈 목록으로 돌아온다 */
  waitForChanges(tabId: string, known: KnownFolder[], signal: AbortSignal): Promise<ListResult>;
  move(tabId: string, items: string[], to: string): Promise<FileResult>;
  copy(tabId: string, items: string[], to: string): Promise<FileResult>;
  rename(tabId: string, path: string, name: string): Promise<FileResult>;
  create(tabId: string, parent: string, name: string, kind: "file" | "folder"): Promise<FileResult>;
  trash(tabId: string, items: string[]): Promise<FileResult>;
  undo(tabId: string): Promise<UndoResult>;
}

export interface TerminalsApi {
  /** automatic이면 이번 실행에서 그 탭에 자동으로 띄운 적이 없을 때만 띄운다 (아니면 terminal이 null) */
  openTerminal(tabId: string, automatic: boolean): Promise<OpenTerminalResult>;
  sendInput(id: string, data: string): Promise<void>;
  resizeTerminal(id: string, columns: number, rows: number): Promise<void>;
  /** 실행 중인 프로그램이 있으면 닫지 않고 busy로 거절한다. force면 묻지 않고 닫는다 */
  closeTerminal(id: string, force: boolean): Promise<CloseTerminalResult>;
  /** 새 출력이 있거나 터미널 목록이 version과 달라질 때까지 기다린다 */
  waitForTerminalEvents(version: number): Promise<TerminalEvents>;
  /** 앱 닫기 확인 창의 답 */
  answerQuit(confirm: boolean): Promise<void>;
}

export interface LayoutApi {
  fetchLayout(): Promise<Layout>;
  /** 배치를 기억시킨다. 코어가 한계 안으로 옮긴 값을 돌려준다 */
  saveLayout(layout: Layout): Promise<Layout>;
}

export type CoreApi = ProjectTabsApi & FilesApi & TerminalsApi & LayoutApi;

const paths = {
  state: "/api/state",
  tabs: "/api/tabs",
  tab: (id: string) => `/api/tabs/${encodeURIComponent(id)}`,
  selectTab: (id: string) => `/api/tabs/${encodeURIComponent(id)}/select`,
  files: (id: string, action: string) => `/api/tabs/${encodeURIComponent(id)}/files/${action}`,
  forceCloseTab: (id: string) => `/api/tabs/${encodeURIComponent(id)}?force=1`,
  layout: "/api/layout",
  tabTerminals: (id: string) => `/api/tabs/${encodeURIComponent(id)}/terminals`,
  terminal: (id: string, action: string) => `/api/terminals/${encodeURIComponent(id)}/${action}`,
  terminalEvents: "/api/terminals/events",
  quit: "/api/app/quit",
};

export function createApiClient(token: string): CoreApi {
  function send(method: string, path: string, body?: unknown, signal?: AbortSignal) {
    return fetch(path, {
      method,
      headers: { "X-VA-Token": token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  }

  async function request(method: string, path: string, body?: unknown): Promise<ProjectTabsState> {
    const response = await send(method, path, body);
    if (!response.ok) throw new Error(`코어 요청 실패: ${method} ${path} → ${response.status}`);
    const state = parseProjectTabsState(await response.json());
    if (!state) throw new Error(`코어 응답을 이해할 수 없습니다: ${method} ${path}`);
    return state;
  }

  /** 파일 요청: 코어가 거절하면 이유를 돌려주고, 응답 모양이 다르면 예외 */
  async function files<T>(
    tabId: string,
    action: string,
    body: unknown,
    parse: (value: unknown) => T | undefined,
    signal?: AbortSignal,
  ): Promise<T | Refused> {
    const path = paths.files(tabId, action);
    const response = await send("POST", path, body, signal);
    const value: unknown = await response.json();
    if (!response.ok) return { ok: false, error: parseErrorCode(value) };
    const parsed = parse(value);
    if (parsed === undefined) throw new Error(`코어 응답을 이해할 수 없습니다: POST ${path}`);
    return parsed;
  }

  /** 답의 모양을 확인해 돌려준다. 코어가 거절했거나 모양이 다르면 예외 */
  async function expect<T>(method: string, path: string, body: unknown, parse: (value: unknown) => T | undefined): Promise<T> {
    const response = await send(method, path, body);
    if (!response.ok) throw new Error(`코어 요청 실패: ${method} ${path} → ${response.status}`);
    const parsed = parse(await response.json());
    if (parsed === undefined) throw new Error(`코어 응답을 이해할 수 없습니다: ${method} ${path}`);
    return parsed;
  }

  /** 답의 내용이 필요 없는 요청. 코어가 거절하면 이유를 돌려준다 */
  async function command(path: string, body: unknown): Promise<{ ok: true } | Refused> {
    const response = await send("POST", path, body);
    if (!response.ok) return { ok: false, error: parseErrorCode(await response.json()) };
    return { ok: true };
  }

  const asList = (value: unknown): ListResult | undefined => {
    const dirs = parseListings(value);
    return dirs && { ok: true, dirs };
  };
  const asChanges = (value: unknown): FileResult | undefined => {
    const changes = parseChanges(value);
    return changes && { ok: true, changes };
  };
  const asUndone = (value: unknown): UndoResult | undefined => {
    const undone = parseUndone(value);
    return undone && { ok: true, undone };
  };

  return {
    fetchState: () => request("GET", paths.state),
    addProject: () => request("POST", paths.tabs, {}),
    selectTab: (id) => request("POST", paths.selectTab(id)),
    closeTab: async (id, force) => {
      const path = force ? paths.forceCloseTab(id) : paths.tab(id);
      const response = await send("DELETE", path);
      const value: unknown = await response.json();
      if (!response.ok) return { ok: false, error: parseErrorCode(value) };
      const state = parseProjectTabsState(value);
      if (!state) throw new Error(`코어 응답을 이해할 수 없습니다: DELETE ${path}`);
      return { ok: true, state };
    },

    list: (tabId, dirs) => files(tabId, "list", { dirs }, asList),
    waitForChanges: (tabId, known, signal) => files(tabId, "changes", { dirs: known }, asList, signal),
    move: (tabId, items, to) => files(tabId, "move", { items, to }, asChanges),
    copy: (tabId, items, to) => files(tabId, "copy", { items, to }, asChanges),
    rename: (tabId, path, name) => files(tabId, "rename", { path, name }, asChanges),
    create: (tabId, parent, name, kind) => files(tabId, "create", { parent, name, kind }, asChanges),
    trash: (tabId, items) => files(tabId, "trash", { items }, asChanges),
    undo: (tabId) => files(tabId, "undo", {}, asUndone),

    fetchLayout: () => expect("GET", paths.layout, undefined, parseLayout),
    saveLayout: (layout) => expect("POST", paths.layout, layout, parseLayout),

    openTerminal: async (tabId, automatic) => {
      const path = paths.tabTerminals(tabId);
      const response = await send("POST", path, { automatic });
      const value: unknown = await response.json();
      if (!response.ok) return { ok: false, error: parseErrorCode(value) };
      const terminal = parseOpened(value);
      if (terminal === undefined) throw new Error(`코어 응답을 이해할 수 없습니다: POST ${path}`);
      return { ok: true, terminal };
    },
    sendInput: async (id, data) => {
      await command(paths.terminal(id, "input"), { data });
    },
    resizeTerminal: async (id, columns, rows) => {
      await command(paths.terminal(id, "resize"), { columns, rows });
    },
    closeTerminal: (id, force) => command(paths.terminal(id, "close"), { force }),
    waitForTerminalEvents: (version) => expect("POST", paths.terminalEvents, { version }, parseTerminalEvents),
    answerQuit: async (confirm) => {
      await command(paths.quit, { confirm });
    },
  };
}
