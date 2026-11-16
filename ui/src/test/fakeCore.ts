// 코어를 흉내 내는 가짜. 화면 테스트에서 실제 코어 대신 쓴다.
// 실제 파일 규칙(덮어쓰지 않기, 프로젝트 폴더 밖 차단 등)은 코어 테스트와 앱 창 테스트가 확인한다.
import type { CoreApi, FileResult, ListResult } from "../data/apiClient";
import { isSameOrInside, joinPath, nameOf, parentOf, type FileChange, type FolderListing } from "../domain/fileTree";
import type { ProjectTabsState } from "../domain/projectTabs";

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
}

export interface FakeCore {
  api: CoreApi;
  /** 탭의 프로젝트에 지금 있는 경로들 (정렬됨, 폴더는 /로 끝남) */
  paths(folderPath: string): string[];
  /** 앱 밖에서 파일이 바뀐 것처럼 만든다 */
  external(folderPath: string, change: (files: Map<string, Kind>) => void): void;
  /** 다음 파일 작업 하나를 이 이유로 실패시킨다 */
  failNext(code: string): void;
  /** 복사를 끝내지 않고 붙잡아 둔다. 돌려받은 함수를 부르면 끝난다 */
  holdCopy(): () => void;
  /** 코어가 받은 파일 작업 요청 수 */
  mutations(): number;
  trashed: string[];
}

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
    closeTab: async (id) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      const neighbor = tabs[index] ?? tabs[tabs.length - 1];
      state = { tabs, activeId: state.activeId === id ? (neighbor?.id ?? "") : state.activeId };
      return snapshot();
    },

    list: async (tabId, dirs): Promise<ListResult> => {
      const files = filesOf(tabId);
      if (!files) return { ok: false, error: "folder_not_found" };
      return { ok: true, dirs: dirs.map((folder) => listing(files, folder)) };
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
    paths(folderPath) {
      return [...projectOf(folderPath)]
        .map(([path, kind]) => (kind === "folder" ? `${path}/` : path))
        .sort();
    },
    external(folderPath, change) {
      change(projectOf(folderPath));
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
  };
}
