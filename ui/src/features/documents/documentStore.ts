// 문서 창의 현재 상태(프로젝트 탭마다 열어 둔 문서, 보고 있는 문서, 문서 창의 너비)를 들고 있고, 바뀌면 화면에 알린다.
// 보고 있는 문서 하나는 파일이 바뀌는지 계속 지켜본다.
import type { DocumentsApi } from "../../data/apiClient";
import {
  defaultDocumentShare,
  documentKind,
  documentName,
  documentNudge,
  documentShareAt,
  type DocumentContent,
  type KnownFile,
  type OpenDocument,
} from "../../domain/documents";
import { activeTab } from "../../domain/projectTabs";
import type { ProjectTabsStore } from "../projectTabs/projectTabsStore";

export interface DocumentSnapshot {
  /** 지금 보고 있는 프로젝트 탭에 열어 둔 문서들 */
  documents: OpenDocument[];
  /** 문서 창에 보이는 문서 */
  activePath: string | null;
  /** 문서 창이 작업 영역에서 차지하는 몫 (0~1) */
  share: number;
}

/** 문서 경계가 놓인 작업 영역의 자리 */
export interface Bounds {
  left: number;
  width: number;
}

export interface DocumentStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DocumentSnapshot;
  /** 지금 보고 있는 프로젝트 탭에서 파일을 문서 창에 연다. 이미 열려 있으면 그 문서를 보인다 */
  open(path: string): void;
  select(path: string): void;
  close(path: string): void;
  /** 그려진 모습과 원문을 오간다 */
  toggleRaw(path: string): void;
  resize(position: number, bounds: Bounds): void;
  nudge(direction: number, bounds: Bounds): void;
  resetShare(): void;
}

interface TabDocuments {
  documents: OpenDocument[];
  activePath: string | null;
}

export function createDocumentStore(api: DocumentsApi, tabs: ProjectTabsStore): DocumentStore {
  const listeners = new Set<() => void>();
  const byTab = new Map<string, TabDocuments>();
  let tabId: string | null = null;
  let share = defaultDocumentShare;
  /** 지금 지켜보고 있는 문서 */
  let watching: { tabId: string; path: string; stop: AbortController } | null = null;
  let snapshot: DocumentSnapshot = build();

  function build(): DocumentSnapshot {
    const current = tabId ? byTab.get(tabId) : undefined;
    return { documents: current?.documents ?? [], activePath: current?.activePath ?? null, share };
  }

  function publish() {
    snapshot = build();
    listeners.forEach((listener) => listener());
  }

  function update(tab: string, path: string, change: (document: OpenDocument) => OpenDocument) {
    const current = byTab.get(tab);
    if (!current) return;
    current.documents = current.documents.map((document) => (document.path === path ? change(document) : document));
  }

  const knownOf = (content: DocumentContent): KnownFile =>
    content.state === "ready" ? { stamp: content.stamp } : content.state === "error" ? { error: content.code } : {};

  async function watch(tab: string, path: string, stop: AbortController) {
    for (;;) {
      const document = byTab.get(tab)?.documents.find((candidate) => candidate.path === path);
      if (!document) return;
      let content: DocumentContent;
      try {
        const result = await api.waitForFileChange(tab, path, knownOf(document.content), stop.signal);
        if (!result.ok) content = { state: "error", code: result.error };
        else if (result.text === null) continue;
        else content = { state: "ready", text: result.text, stamp: result.stamp };
      } catch {
        // 지켜보기를 그만두었거나 코어와 연결이 끊겼다
        return;
      }
      if (stop.signal.aborted) return;
      update(tab, path, (current) => ({ ...current, content }));
      publish();
    }
  }

  /** 보고 있는 문서가 바뀌었으면 그 문서를 지켜보기 시작한다 */
  function syncWatch() {
    const path = tabId ? (byTab.get(tabId)?.activePath ?? null) : null;
    if (watching && watching.tabId === tabId && watching.path === path) return;
    watching?.stop.abort();
    watching = null;
    if (!tabId || !path) return;
    watching = { tabId, path, stop: new AbortController() };
    void watch(tabId, path, watching.stop);
  }

  function syncActiveTab() {
    const { state } = tabs.getSnapshot();
    for (const known of [...byTab.keys()]) {
      if (!state.tabs.some((tab) => tab.id === known)) byTab.delete(known);
    }
    const next = activeTab(state)?.id ?? null;
    if (next === tabId) return;
    tabId = next;
    syncWatch();
    publish();
  }

  function changeShare(next: number) {
    if (next === share) return;
    share = next;
    publish();
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

    open(path) {
      if (!tabId) return;
      let current = byTab.get(tabId);
      if (!current) {
        current = { documents: [], activePath: null };
        byTab.set(tabId, current);
      }
      if (!current.documents.some((document) => document.path === path)) {
        current.documents = [
          ...current.documents,
          { path, name: documentName(path), kind: documentKind(path), content: { state: "loading" }, raw: false },
        ];
      }
      current.activePath = path;
      syncWatch();
      publish();
    },

    select(path) {
      const current = tabId ? byTab.get(tabId) : undefined;
      if (!current || !current.documents.some((document) => document.path === path)) return;
      current.activePath = path;
      syncWatch();
      publish();
    },

    close(path) {
      const current = tabId ? byTab.get(tabId) : undefined;
      if (!current) return;
      const index = current.documents.findIndex((document) => document.path === path);
      if (index === -1) return;
      current.documents = current.documents.filter((document) => document.path !== path);
      if (current.activePath === path) {
        // 닫은 문서의 오른쪽 문서, 없으면 왼쪽 문서를 보인다
        current.activePath = (current.documents[index] ?? current.documents[index - 1])?.path ?? null;
      }
      syncWatch();
      publish();
    },

    toggleRaw(path) {
      if (!tabId) return;
      update(tabId, path, (document) => ({ ...document, raw: !document.raw }));
      publish();
    },

    resize(position, bounds) {
      changeShare(documentShareAt(position, bounds.left, bounds.width));
    },

    nudge(direction, bounds) {
      // 경계를 오른쪽으로 옮기면 문서 창이 좁아진다
      const boundary = bounds.left + bounds.width * (1 - share) + direction * documentNudge;
      changeShare(documentShareAt(boundary, bounds.left, bounds.width));
    },

    resetShare() {
      changeShare(defaultDocumentShare);
    },
  };
}
