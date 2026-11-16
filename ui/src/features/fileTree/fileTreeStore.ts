// 파일 칸의 현재 상태(펼친 폴더, 선택, 복사해 둔 것 등)를 프로젝트 탭마다 들고 있고, 바뀌면 화면에 알린다.
import type { FileResult, FilesApi } from "../../data/apiClient";
import {
  ROOT,
  canDrop,
  fileErrorMessage,
  folderFor,
  isSameOrInside,
  nameOf,
  rangeBetween,
  remapPath,
  undoMessage,
  visibleRows,
  type FileAction,
  type FileChange,
  type FolderListing,
  type Notice,
  type TreeState,
} from "../../domain/fileTree";
import { activeTab } from "../../domain/projectTabs";
import type { ProjectTabsStore } from "../projectTabs/projectTabsStore";

export interface FileTreeSnapshot {
  tabId: string | null;
  /** 탭의 폴더를 찾을 수 없음 */
  missing: boolean;
  tree: TreeState | null;
}

export interface SelectModifiers {
  ctrl: boolean;
  shift: boolean;
}

export interface FileTreeStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): FileTreeSnapshot;
  toggleFolder(path: string): Promise<void>;
  setExpanded(path: string, expanded: boolean): Promise<void>;
  select(path: string, modifiers: SelectModifiers): void;
  openMenu(x: number, y: number, target: string | null): void;
  /** Esc: 메뉴를 닫고, 메뉴가 없으면 잘라내기를 취소한다 */
  escape(): void;
  startCreate(kind: "file" | "folder", target: string | null): Promise<void>;
  submitCreate(name: string): Promise<void>;
  startRename(): void;
  submitRename(name: string): Promise<void>;
  cancelEdit(): void;
  requestTrash(): void;
  confirmTrash(): Promise<void>;
  cancelTrash(): void;
  copy(): void;
  cut(): void;
  /** target을 주지 않으면 키보드가 가리키는 줄을 기준으로 붙여넣는다 */
  paste(target?: string | null): Promise<void>;
  undo(): Promise<void>;
  dragStart(path: string): void;
  dragOver(folder: string | null): void;
  drop(folder: string): Promise<void>;
  dragEnd(): void;
  dismissNotice(): void;
}

const disconnected: Notice = { tone: "error", text: "코어와 연결이 끊겼습니다. 앱을 다시 실행해 주세요." };

function emptyTree(): TreeState {
  return {
    dirs: new Map(),
    expanded: new Set(),
    rows: [],
    selected: new Set(),
    cursor: null,
    anchor: null,
    clipboard: null,
    renaming: null,
    draft: null,
    menu: null,
    confirmTrash: null,
    notice: null,
    busy: false,
    dragging: null,
    dropTarget: null,
    rootMissing: false,
  };
}

export function createFileTreeStore(api: FilesApi, tabs: ProjectTabsStore): FileTreeStore {
  const trees = new Map<string, TreeState>();
  const listeners = new Set<() => void>();
  let activeId: string | null = null;
  let missing = false;
  let snapshot: FileTreeSnapshot = { tabId: null, missing: false, tree: null };
  let watching: AbortController | null = null;

  function publish() {
    snapshot = { tabId: activeId, missing, tree: activeId ? (trees.get(activeId) ?? null) : null };
    listeners.forEach((listener) => listener());
  }

  function update(tabId: string, patch: Partial<TreeState>) {
    const current = trees.get(tabId);
    if (!current) return;
    const next = { ...current, ...patch };
    next.rows = visibleRows(next.dirs, next.expanded, next.draft);
    // 보이지 않게 된 줄은 선택에서 뺀다
    const visible = new Set(next.rows.map((row) => row.path));
    if ([...next.selected].some((path) => !visible.has(path))) {
      next.selected = new Set([...next.selected].filter((path) => visible.has(path)));
    }
    if (next.cursor !== null && !visible.has(next.cursor)) next.cursor = null;
    if (next.anchor !== null && !visible.has(next.anchor)) next.anchor = null;
    trees.set(tabId, next);
    if (tabId === activeId) publish();
  }

  /** 지금 보고 있는 탭과 그 상태. 열린 프로젝트가 없으면 undefined */
  function current(): { tabId: string; tree: TreeState } | undefined {
    if (!activeId) return undefined;
    const tree = trees.get(activeId);
    return tree ? { tabId: activeId, tree } : undefined;
  }

  function applyListings(tabId: string, listings: readonly FolderListing[]) {
    const tree = trees.get(tabId);
    if (!tree) return;
    const dirs = new Map(tree.dirs);
    const expanded = new Set(tree.expanded);
    let rootMissing = tree.rootMissing;
    for (const listing of listings) {
      if (!listing.missing) {
        dirs.set(listing.path, listing);
      } else if (listing.path === ROOT) {
        rootMissing = true;
      } else {
        for (const path of [...dirs.keys()]) if (isSameOrInside(path, listing.path)) dirs.delete(path);
        for (const path of [...expanded]) if (isSameOrInside(path, listing.path)) expanded.delete(path);
      }
    }
    update(tabId, { dirs, expanded, rootMissing });
  }

  async function refresh(tabId: string) {
    const tree = trees.get(tabId);
    if (!tree) return;
    try {
      const result = await api.list(tabId, [ROOT, ...tree.expanded]);
      if (result.ok) applyListings(tabId, result.dirs);
      else if (result.error === "folder_not_found") update(tabId, { rootMissing: true });
    } catch {
      update(tabId, { notice: disconnected });
    }
  }

  /** 펼쳐져 있는 폴더가 앱 밖에서 바뀌는지 코어에 물어 두고, 바뀌면 반영한다 */
  function restartWatch() {
    watching?.abort();
    watching = null;
    const tabId = activeId;
    if (!tabId || missing) return;
    const controller = new AbortController();
    watching = controller;

    void (async () => {
      while (!controller.signal.aborted) {
        const tree = trees.get(tabId);
        if (!tree || tree.rootMissing) return;
        const known = [ROOT, ...tree.expanded].map((path) => ({
          path,
          stamp: tree.dirs.get(path)?.stamp ?? "",
        }));
        try {
          const result = await api.waitForChanges(tabId, known, controller.signal);
          if (controller.signal.aborted) return;
          if (!result.ok) {
            if (result.error === "folder_not_found") update(tabId, { rootMissing: true });
            return;
          }
          if (result.dirs.length > 0) applyListings(tabId, result.dirs);
        } catch {
          return;
        }
      }
    })();
  }

  function syncActiveTab() {
    const { state } = tabs.getSnapshot();
    for (const id of [...trees.keys()]) {
      if (!state.tabs.some((tab) => tab.id === id)) trees.delete(id);
    }
    const tab = activeTab(state);
    const nextId = tab?.id ?? null;
    const nextMissing = tab?.missing ?? false;
    if (nextId === activeId && nextMissing === missing) return;

    activeId = nextId;
    missing = nextMissing;
    const usable = nextId !== null && !nextMissing;
    if (usable && !trees.has(nextId)) trees.set(nextId, emptyTree());
    publish();
    restartWatch();
    if (usable) void refresh(nextId);
  }

  /** 파일 작업 하나를 코어에 시키고, 실패하면 이유를 알리고, 끝나면 폴더 내용을 다시 읽는다 */
  async function perform(
    action: FileAction,
    tabId: string,
    call: () => Promise<FileResult>,
  ): Promise<FileChange[] | null> {
    update(tabId, { notice: null, menu: null });
    try {
      const result = await call();
      if (!result.ok) {
        update(tabId, { notice: { tone: "error", text: fileErrorMessage(action, result.error) } });
        await refresh(tabId);
        return null;
      }
      return result.changes;
    } catch {
      update(tabId, { notice: disconnected });
      return null;
    }
  }

  /** 옮기거나 이름을 바꾼 뒤: 펼쳐 둔 폴더를 새 자리로 고치고, 바뀐 것을 선택한다 */
  async function settle(tabId: string, changes: readonly FileChange[], selectTargets: boolean) {
    const tree = trees.get(tabId);
    if (!tree) return;
    const expanded = new Set([...tree.expanded].map((path) => remapPath(path, changes)));
    update(tabId, { expanded });
    await refresh(tabId);
    if (selectTargets && changes.length > 0) {
      const targets = changes.map((change) => change.to);
      update(tabId, { selected: new Set(targets), cursor: targets[0] ?? null, anchor: targets[0] ?? null });
    }
    restartWatch();
  }

  async function setExpanded(path: string, open: boolean) {
    const now = current();
    if (!now || now.tree.expanded.has(path) === open) return;
    const { tabId } = now;
    const expanded = new Set(now.tree.expanded);
    if (open) expanded.add(path);
    else expanded.delete(path);
    update(tabId, { expanded });
    if (open) {
      try {
        const result = await api.list(tabId, [path]);
        if (result.ok) applyListings(tabId, result.dirs);
      } catch {
        update(tabId, { notice: disconnected });
      }
    }
    restartWatch();
  }

  tabs.subscribe(syncActiveTab);
  syncActiveTab();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,

    setExpanded,
    toggleFolder(path) {
      const now = current();
      return now ? setExpanded(path, !now.tree.expanded.has(path)) : Promise.resolve();
    },

    select(path, { ctrl, shift }) {
      const now = current();
      if (!now) return;
      const { tabId, tree } = now;
      if (shift) {
        const range = rangeBetween(tree.rows, tree.anchor ?? path, path);
        update(tabId, { selected: new Set(range), cursor: path, anchor: tree.anchor ?? path });
      } else if (ctrl) {
        const selected = new Set(tree.selected);
        if (selected.has(path)) selected.delete(path);
        else selected.add(path);
        update(tabId, { selected, cursor: path, anchor: path });
      } else {
        update(tabId, { selected: new Set([path]), cursor: path, anchor: path });
      }
    },

    openMenu(x, y, target) {
      const now = current();
      if (!now) return;
      const { tabId, tree } = now;
      if (target !== null && !tree.selected.has(target)) {
        update(tabId, { selected: new Set([target]), cursor: target, anchor: target });
      }
      update(tabId, { menu: { x, y, target }, renaming: null, draft: null });
    },

    escape() {
      const now = current();
      if (!now) return;
      if (now.tree.menu) update(now.tabId, { menu: null });
      else if (now.tree.clipboard?.mode === "cut") update(now.tabId, { clipboard: null });
    },

    async startCreate(kind, target) {
      const now = current();
      if (!now) return;
      const parent = folderFor(now.tree.rows, target);
      update(now.tabId, { menu: null, renaming: null, notice: null });
      if (parent !== ROOT) await setExpanded(parent, true);
      update(now.tabId, { draft: { parent, kind } });
    },

    async submitCreate(rawName) {
      const now = current();
      const draft = now?.tree.draft;
      if (!now || !draft) return;
      const { tabId } = now;
      const name = rawName.trim();
      update(tabId, { draft: null });
      if (name === "") return;
      const changes = await perform("create", tabId, () => api.create(tabId, draft.parent, name, draft.kind));
      if (changes) await settle(tabId, changes, true);
    },

    startRename() {
      const now = current();
      if (!now || now.tree.selected.size !== 1) return;
      const [path] = [...now.tree.selected];
      update(now.tabId, { renaming: path ?? null, draft: null, menu: null, notice: null });
    },

    async submitRename(rawName) {
      const now = current();
      const path = now?.tree.renaming;
      if (!now || !path) return;
      const { tabId } = now;
      const name = rawName.trim();
      update(tabId, { renaming: null });
      if (name === "" || name === nameOf(path)) return;
      const changes = await perform("rename", tabId, () => api.rename(tabId, path, name));
      if (changes) await settle(tabId, changes, true);
    },

    cancelEdit() {
      const now = current();
      if (now) update(now.tabId, { renaming: null, draft: null });
    },

    requestTrash() {
      const now = current();
      if (!now || now.tree.selected.size === 0) return;
      update(now.tabId, { confirmTrash: [...now.tree.selected], menu: null });
    },

    async confirmTrash() {
      const now = current();
      const items = now?.tree.confirmTrash;
      if (!now || !items) return;
      const { tabId } = now;
      update(tabId, { confirmTrash: null });
      const changes = await perform("trash", tabId, () => api.trash(tabId, [...items]));
      if (changes) {
        update(tabId, { selected: new Set(), cursor: null, anchor: null });
        await settle(tabId, [], false);
      }
    },

    cancelTrash() {
      const now = current();
      if (now) update(now.tabId, { confirmTrash: null });
    },

    copy() {
      const now = current();
      if (!now || now.tree.selected.size === 0) return;
      update(now.tabId, { clipboard: { mode: "copy", items: [...now.tree.selected] }, menu: null });
    },

    cut() {
      const now = current();
      if (!now || now.tree.selected.size === 0) return;
      update(now.tabId, { clipboard: { mode: "cut", items: [...now.tree.selected] }, menu: null });
    },

    async paste(target) {
      const now = current();
      const clipboard = now?.tree.clipboard;
      if (!now || !clipboard || now.tree.busy) return;
      const { tabId, tree } = now;
      const folder = folderFor(tree.rows, target === undefined ? tree.cursor : target);

      if (clipboard.mode === "cut") {
        const changes = await perform("paste", tabId, () => api.move(tabId, clipboard.items, folder));
        if (!changes) return;
        update(tabId, { clipboard: null });
        await settle(tabId, changes, true);
        return;
      }

      update(tabId, { busy: true });
      const changes = await perform("paste", tabId, () => api.copy(tabId, clipboard.items, folder));
      update(tabId, { busy: false });
      if (!changes) return;
      if (folder !== ROOT) await setExpanded(folder, true);
      await settle(tabId, changes, true);
    },

    async undo() {
      const now = current();
      if (!now) return;
      const { tabId } = now;
      update(tabId, { notice: null, menu: null });
      try {
        const result = await api.undo(tabId);
        if (!result.ok) {
          const tone = result.error === "nothing_to_undo" ? "info" : "error";
          update(tabId, { notice: { tone, text: fileErrorMessage("undo", result.error) } });
          await refresh(tabId);
          return;
        }
        // 되돌린 옮기기·이름 바꾸기는 방향이 반대다
        const reverted = result.undone.items.map((item) => ({ from: item.to, to: item.from }));
        const moved = result.undone.kind === "move" || result.undone.kind === "rename";
        await settle(tabId, moved ? reverted : [], moved);
        update(tabId, { notice: { tone: "info", text: undoMessage(result.undone) } });
      } catch {
        update(tabId, { notice: disconnected });
      }
    },

    dragStart(path) {
      const now = current();
      if (!now) return;
      const { tabId, tree } = now;
      if (tree.selected.has(path)) {
        update(tabId, { dragging: [...tree.selected], menu: null });
      } else {
        update(tabId, { dragging: [path], selected: new Set([path]), cursor: path, anchor: path, menu: null });
      }
    },

    dragOver(folder) {
      const now = current();
      if (!now || !now.tree.dragging) return;
      const target = folder !== null && canDrop(now.tree.dragging, folder) ? folder : null;
      if (target !== now.tree.dropTarget) update(now.tabId, { dropTarget: target });
    },

    async drop(folder) {
      const now = current();
      const items = now?.tree.dragging;
      if (!now || !items) return;
      const { tabId } = now;
      update(tabId, { dragging: null, dropTarget: null });
      if (!canDrop(items, folder)) return;
      const changes = await perform("move", tabId, () => api.move(tabId, [...items], folder));
      if (!changes) return;
      if (folder !== ROOT) await setExpanded(folder, true);
      await settle(tabId, changes, true);
    },

    dragEnd() {
      const now = current();
      if (now && (now.tree.dragging || now.tree.dropTarget !== null)) {
        update(now.tabId, { dragging: null, dropTarget: null });
      }
    },

    dismissNotice() {
      const now = current();
      if (now) update(now.tabId, { notice: null });
    },
  };
}
