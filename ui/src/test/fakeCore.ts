// 코어를 흉내 내는 가짜. 화면 테스트에서 실제 코어 대신 쓴다.
// 실제 파일 규칙(덮어쓰지 않기, 프로젝트 폴더 밖 차단 등)은 코어 테스트와 앱 창 테스트가 확인한다.
import type { CoreApi, FileResult, ListResult, ReadFileResult } from "../data/apiClient";
import { isSameOrInside, joinPath, nameOf, parentOf, type FileChange, type FolderListing } from "../domain/fileTree";
import { defaultLayout, type Layout } from "../domain/layout";
import type { ProjectTabsState } from "../domain/projectTabs";
import type { TerminalEvents, TerminalInfo, TerminalOutput } from "../domain/terminals";

type Kind = "folder" | "file";
interface Operation {
  kind: "move" | "rename" | "create" | "copy";
  items: FileChange[];
}

export interface FakeCoreOptions {
  /** "폴더 선택 창에서 고를" 폴더들. 차례로 하나씩 쓰인다 */
  picks: string[];
  /** 찾을 수 없는 폴더 */
  missing?: string[];
  /** 폴더별 내용. "src/" 처럼 /로 끝나면 폴더다 */
  files?: Record<string, string[]>;
  /** 코어가 기억하고 있는 화면 배치. 주지 않으면 처음 값 */
  layout?: Layout;
  /** 이 컴퓨터에서 뜨는 셸. 주지 않으면 PowerShell 7. null이면 띄울 셸이 없다 */
  shell?: "pwsh" | "cmd" | null;
}

/** 가짜 코어의 터미널을 테스트에서 조작하는 손잡이 */
export interface FakeTerminals {
  list(): TerminalInfo[];
  /** 터미널에 출력이 나온 것처럼 만든다 */
  emit(id: string, text: string): void;
  /** 글자가 아닌 바이트 그대로 내보낸다 (글자 중간에서 끊긴 출력을 만들 때) */
  emitBytes(id: string, bytes: Uint8Array): void;
  /** 터미널에서 에이전트가 실행된(끝난) 것처럼 만든다. 빈 문자열이면 끝난 것 */
  setAgent(id: string, agent: string): void;
  /** 터미널에서 프로그램이 돌고 있는(끝난) 것처럼 만든다 */
  setBusy(id: string, busy: boolean): void;
  /** 셸이 스스로 끝난 것처럼 만든다 (exit) */
  exit(id: string): void;
  /** 사용자가 앱 창의 닫기를 누른 것처럼 만든다 */
  requestQuit(): void;
  /** 다음 터미널 띄우기를 이 이유로 실패시킨다 */
  failNextOpen(code: string): void;
  /** 글자 보내기를 끝내지 않고 붙잡아 둔다. 돌려받은 함수를 부르면 끝난다 */
  holdInput(): () => void;
  /** 터미널이 받은 글자 (요청 하나가 한 항목) */
  inputs(id: string): string[];
  /** 터미널이 받은 크기 변경 */
  sizes(id: string): string[];
  /** 앱 닫기 확인 창에 한 답 */
  quitAnswers: boolean[];
  /** 터미널 소식을 기다리는 요청을 실패시킨다 (코어와 연결이 끊김) */
  disconnect(): void;
}

export interface FakeCore {
  api: CoreApi;
  /** 코어가 기억하고 있는 화면 배치 */
  layout(): Layout;
  /** 탭의 프로젝트에 지금 있는 경로들 (정렬됨, 폴더는 /로 끝남) */
  paths(folderPath: string): string[];
  /** 앱 밖에서 파일이 바뀐 것처럼 만든다 */
  external(folderPath: string, change: (files: Map<string, Kind>) => void): void;
  /** 파일에 내용을 쓴다 (에이전트나 다른 프로그램이 저장한 것처럼). 없던 파일이면 만든다 */
  writeFile(folderPath: string, path: string, text: string): void;
  /** 파일을 이 이유로 열 수 없게 만든다 ("not_text", "too_large" 등) */
  breakFile(folderPath: string, path: string, code: string): void;
  /** 다음 파일 작업 하나를 이 이유로 실패시킨다 */
  failNext(code: string): void;
  /** 복사를 끝내지 않고 붙잡아 둔다. 돌려받은 함수를 부르면 끝난다 */
  holdCopy(): () => void;
  /** 코어가 받은 파일 작업 요청 수 */
  mutations(): number;
  trashed: string[];
  terminals: FakeTerminals;
}

const shellLabels = { pwsh: "PowerShell", cmd: "cmd" };

export function fakeCore(options: FakeCoreOptions): FakeCore {
  let nextId = 1;
  let state: ProjectTabsState = { tabs: [], activeId: "" };
  const queue = [...options.picks];
  const missing = options.missing ?? [];
  const projects = new Map<string, Map<string, Kind>>();
  const history = new Map<string, Operation[]>();
  const waiters = new Set<() => void>();
  const trashed: string[] = [];
  let failure: string | null = null;
  let copyGate: Promise<void> | null = null;
  let mutationCount = 0;

  const shellId = options.shell === undefined ? "pwsh" : options.shell;
  let layout: Layout = options.layout ?? defaultLayout;
  let terminals: TerminalInfo[] = [];
  let terminalVersion = 1;
  let nextTerminalId = 1;
  let pendingOutput: TerminalOutput[] = [];
  let quitRequests = 0;
  let openFailure: string | null = null;
  let inputGate: Promise<void> | null = null;
  let connectionLost = false;
  const autoStarted = new Set<string>();
  const terminalWaiters = new Set<() => void>();
  const terminalInputs = new Map<string, string[]>();
  const terminalSizes = new Map<string, string[]>();
  const quitAnswers: boolean[] = [];

  const wakeTerminals = () => {
    const pending = [...terminalWaiters];
    terminalWaiters.clear();
    pending.forEach((resolve) => resolve());
  };
  const changeTerminals = (next: TerminalInfo[]) => {
    terminals = next;
    terminalVersion++;
    wakeTerminals();
  };
  const patchTerminal = (id: string, patch: Partial<TerminalInfo>) =>
    changeTerminals(terminals.map((terminal) => (terminal.id === id ? { ...terminal, ...patch } : terminal)));

  const snapshot = () => structuredClone(state);
  const wake = () => {
    const pending = [...waiters];
    waiters.clear();
    pending.forEach((resolve) => resolve());
  };

  function projectOf(folderPath: string): Map<string, Kind> {
    let files = projects.get(folderPath);
    if (!files) {
      files = new Map();
      for (const entry of options.files?.[folderPath] ?? []) {
        const isFolder = entry.endsWith("/");
        const path = isFolder ? entry.slice(0, -1) : entry;
        for (let parent = parentOf(path); parent !== ""; parent = parentOf(parent)) files.set(parent, "folder");
        files.set(path, isFolder ? "folder" : "file");
      }
      projects.set(folderPath, files);
    }
    return files;
  }

  function filesOf(tabId: string): Map<string, Kind> | undefined {
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    return tab && !tab.missing ? projectOf(tab.path) : undefined;
  }

  /** 파일의 내용. 적어 준 적이 없는 파일은 빈 파일이다 */
  const contents = new Map<string, { text: string; stamp: number } | { error: string }>();
  let lastStamp = 0;
  const contentKey = (folderPath: string, path: string) => `${folderPath}\n${path}`;

  function readFile(tabId: string, path: string): ReadFileResult {
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    const files = filesOf(tabId);
    if (!tab || !files) return { ok: false, error: "folder_not_found" };
    const kind = files.get(path);
    if (kind === undefined) return { ok: false, error: "not_found" };
    if (kind !== "file") return { ok: false, error: "not_file" };
    const content = contents.get(contentKey(tab.path, path)) ?? { text: "", stamp: 0 };
    if ("error" in content) return { ok: false, error: content.error };
    return { ok: true, stamp: String(content.stamp), text: content.text };
  }

  function listing(files: Map<string, Kind>, folder: string): FolderListing {
    if (folder !== "" && files.get(folder) !== "folder") return { path: folder, missing: true, stamp: "", entries: [] };
    const entries = [...files]
      .filter(([path]) => parentOf(path) === folder && path !== "")
      .map(([path, kind]) => ({ name: nameOf(path), kind }))
      .sort((a, b) => (a.kind === b.kind ? a.name.toLowerCase().localeCompare(b.name.toLowerCase()) : a.kind === "folder" ? -1 : 1));
    return { path: folder, missing: false, stamp: JSON.stringify(entries), entries };
  }

  function relocate(files: Map<string, Kind>, from: string, to: string, keep: boolean) {
    for (const [path, kind] of [...files]) {
      if (!isSameOrInside(path, from)) continue;
      if (!keep) files.delete(path);
      files.set(to + path.slice(from.length), kind);
    }
  }

  function remove(files: Map<string, Kind>, target: string) {
    for (const path of [...files.keys()]) if (isSameOrInside(path, target)) files.delete(path);
  }

  function copyName(files: Map<string, Kind>, folder: string, name: string, kind: Kind): string {
    if (!files.has(joinPath(folder, name))) return name;
    const dot = kind === "file" ? name.lastIndexOf(".") : -1;
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    for (let number = 1; ; number++) {
      const candidate = `${stem} - 복사본${number === 1 ? "" : ` (${number})`}${extension}`;
      if (!files.has(joinPath(folder, candidate))) return candidate;
    }
  }

  /** 파일 작업 하나를 한다. 되돌릴 수 있는 것이면 기록에 올린다 */
  async function mutate(
    tabId: string,
    kind: Operation["kind"] | null,
    action: (files: Map<string, Kind>) => FileChange[] | string,
  ): Promise<FileResult> {
    mutationCount++;
    const files = filesOf(tabId);
    if (!files) return { ok: false, error: "folder_not_found" };
    if (failure) {
      const error = failure;
      failure = null;
      return { ok: false, error };
    }
    const result = action(files);
    if (typeof result === "string") return { ok: false, error: result };
    if (kind && result.length > 0) history.set(tabId, [...(history.get(tabId) ?? []), { kind, items: result }]);
    wake();
    return { ok: true, changes: result };
  }

  const api: CoreApi = {
    fetchState: async () => snapshot(),
    addProject: async () => {
      const path = queue.shift();
      if (!path) return snapshot(); // 취소
      const existing = state.tabs.find((tab) => tab.path === path);
      if (existing) {
        state = { ...state, activeId: existing.id };
        return snapshot();
      }
      const name = path.split("\\").pop() ?? path;
      const id = `t${nextId++}`;
      state = {
        tabs: [...state.tabs, { id, name, label: name, path, missing: missing.includes(path) }],
        activeId: id,
      };
      return snapshot();
    },
    selectTab: async (id) => {
      state = { ...state, activeId: id };
      return snapshot();
    },
    closeTab: async (id, force) => {
      if (!force && terminals.some((terminal) => terminal.tabId === id && terminal.busy)) {
        return { ok: false, error: "busy" };
      }
      changeTerminals(terminals.filter((terminal) => terminal.tabId !== id));
      autoStarted.delete(id);
      const index = state.tabs.findIndex((tab) => tab.id === id);
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      const neighbor = tabs[index] ?? tabs[tabs.length - 1];
      state = { tabs, activeId: state.activeId === id ? (neighbor?.id ?? "") : state.activeId };
      return { ok: true, state: snapshot() };
    },

    fetchLayout: async () => layout,
    saveLayout: async (next) => {
      layout = next;
      return layout;
    },

    openTerminal: async (tabId, automatic) => {
      const tab = state.tabs.find((candidate) => candidate.id === tabId);
      if (!tab) return { ok: false, error: "tab_not_found" };
      if (tab.missing) return { ok: false, error: "folder_not_found" };
      if (automatic) {
        if (autoStarted.has(tabId)) return { ok: true, terminal: null };
        autoStarted.add(tabId);
      }
      if (openFailure) {
        const error = openFailure;
        openFailure = null;
        return { ok: false, error };
      }
      if (!shellId) return { ok: false, error: "no_shell" };
      const used = terminals.filter((terminal) => terminal.tabId === tabId).map((terminal) => Number(terminal.name.split(" ").pop()));
      let number = 1;
      while (used.includes(number)) number++;
      const terminal: TerminalInfo = {
        id: `p${nextTerminalId++}`,
        tabId,
        shell: shellId,
        name: `${shellLabels[shellId]} ${number}`,
        agent: "",
        busy: false,
      };
      changeTerminals([...terminals, terminal]);
      return { ok: true, terminal };
    },
    sendInput: async (id, data) => {
      if (inputGate) await inputGate;
      terminalInputs.set(id, [...(terminalInputs.get(id) ?? []), data]);
    },
    resizeTerminal: async (id, columns, rows) => {
      terminalSizes.set(id, [...(terminalSizes.get(id) ?? []), `${columns}x${rows}`]);
    },
    closeTerminal: async (id, force) => {
      const terminal = terminals.find((candidate) => candidate.id === id);
      if (!terminal) return { ok: false, error: "terminal_not_found" };
      if (terminal.busy && !force) return { ok: false, error: "busy" };
      changeTerminals(terminals.filter((candidate) => candidate.id !== id));
      return { ok: true };
    },
    waitForTerminalEvents: async (version): Promise<TerminalEvents> => {
      while (version === terminalVersion && pendingOutput.length === 0 && !connectionLost) {
        await new Promise<void>((resolve) => terminalWaiters.add(resolve));
      }
      if (connectionLost) throw new Error("연결이 끊김");
      const output = pendingOutput;
      pendingOutput = [];
      return { version: terminalVersion, terminals: structuredClone(terminals), output, quitRequests };
    },
    answerQuit: async (confirm) => {
      quitAnswers.push(confirm);
    },

    list: async (tabId, dirs): Promise<ListResult> => {
      const files = filesOf(tabId);
      if (!files) return { ok: false, error: "folder_not_found" };
      return { ok: true, dirs: dirs.map((folder) => listing(files, folder)) };
    },

    waitForFileChange: async (tabId, path, known, signal): Promise<ReadFileResult> => {
      for (;;) {
        const result = readFile(tabId, path);
        const same = result.ok ? result.stamp === known.stamp : result.error === known.error;
        if (!same) return result;
        await new Promise<void>((resolve, reject) => {
          waiters.add(resolve);
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
    },

    waitForChanges: async (tabId, known, signal): Promise<ListResult> => {
      for (;;) {
        const files = filesOf(tabId);
        if (!files) return { ok: false, error: "folder_not_found" };
        const changed = known
          .map((item) => ({ item, now: listing(files, item.path) }))
          .filter(({ item, now }) => now.missing || now.stamp !== item.stamp)
          .map(({ now }) => now);
        if (changed.length > 0) return { ok: true, dirs: changed };
        await new Promise<void>((resolve, reject) => {
          waiters.add(resolve);
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
    },

    move: (tabId, items, to) =>
      mutate(tabId, "move", (files) => {
        if (items.some((item) => isSameOrInside(to, item))) return "into_itself";
        const moving = items.filter((item) => parentOf(item) !== to);
        if (moving.some((item) => files.has(joinPath(to, nameOf(item))))) return "name_taken";
        return moving.map((item) => {
          const target = joinPath(to, nameOf(item));
          relocate(files, item, target, false);
          return { from: item, to: target };
        });
      }),

    copy: async (tabId, items, to) => {
      if (copyGate) await copyGate;
      return mutate(tabId, "copy", (files) => {
        if (items.some((item) => isSameOrInside(to, item))) return "into_itself";
        return items.map((item) => {
          const target = joinPath(to, copyName(files, to, nameOf(item), files.get(item) ?? "file"));
          relocate(files, item, target, true);
          return { from: "", to: target };
        });
      });
    },

    rename: (tabId, path, name) =>
      mutate(tabId, "rename", (files) => {
        if (/[\\/:*?"<>|]/.test(name)) return "invalid_name";
        const target = joinPath(parentOf(path), name);
        if (files.has(target)) return "name_taken";
        relocate(files, path, target, false);
        return [{ from: path, to: target }];
      }),

    create: (tabId, parent, name, kind) =>
      mutate(tabId, "create", (files) => {
        if (/[\\/:*?"<>|]/.test(name)) return "invalid_name";
        const target = joinPath(parent, name);
        if (files.has(target)) return "name_taken";
        files.set(target, kind);
        return [{ from: "", to: target }];
      }),

    trash: (tabId, items) =>
      mutate(tabId, null, (files) => {
        for (const item of items) {
          trashed.push(item);
          remove(files, item);
        }
        return items.map((item) => ({ from: item, to: "" }));
      }),

    undo: async (tabId) => {
      mutationCount++;
      const files = filesOf(tabId);
      const operation = history.get(tabId)?.pop();
      if (!files || !operation) return { ok: false, error: "nothing_to_undo" };
      for (const item of operation.items) {
        if (operation.kind === "move" || operation.kind === "rename") relocate(files, item.to, item.from, false);
        else remove(files, item.to);
      }
      wake();
      return { ok: true, undone: operation };
    },
  };

  return {
    api,
    layout: () => layout,
    paths(folderPath) {
      return [...projectOf(folderPath)]
        .map(([path, kind]) => (kind === "folder" ? `${path}/` : path))
        .sort();
    },
    external(folderPath, change) {
      change(projectOf(folderPath));
      wake();
    },
    writeFile(folderPath, path, text) {
      projectOf(folderPath).set(path, "file");
      contents.set(contentKey(folderPath, path), { text, stamp: ++lastStamp });
      wake();
    },
    breakFile(folderPath, path, code) {
      projectOf(folderPath).set(path, "file");
      contents.set(contentKey(folderPath, path), { error: code });
      wake();
    },
    failNext(code) {
      failure = code;
    },
    holdCopy() {
      let release = () => {};
      copyGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        copyGate = null;
        release();
      };
    },
    mutations: () => mutationCount,
    trashed,
    terminals: {
      list: () => structuredClone(terminals),
      emit(id, text) {
        pendingOutput.push({ id, bytes: new TextEncoder().encode(text) });
        wakeTerminals();
      },
      emitBytes(id, bytes) {
        pendingOutput.push({ id, bytes });
        wakeTerminals();
      },
      setAgent: (id, agent) => patchTerminal(id, { agent, busy: agent !== "" }),
      setBusy: (id, busy) => patchTerminal(id, { busy }),
      exit: (id) => changeTerminals(terminals.filter((terminal) => terminal.id !== id)),
      requestQuit() {
        quitRequests++;
        terminalVersion++;
        wakeTerminals();
      },
      failNextOpen(code) {
        openFailure = code;
      },
      holdInput() {
        let release = () => {};
        inputGate = new Promise<void>((resolve) => {
          release = resolve;
        });
        return () => {
          inputGate = null;
          release();
        };
      },
      inputs: (id) => terminalInputs.get(id) ?? [],
      sizes: (id) => terminalSizes.get(id) ?? [],
      quitAnswers,
      disconnect() {
        connectionLost = true;
        wakeTerminals();
      },
    },
  };
}
