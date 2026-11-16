// 프로젝트 탭 상태를 화면 조각들에 연결한다.
import { useSyncExternalStore } from "react";
import { activeTab } from "../../domain/projectTabs";
import { FolderPickerScreen } from "../../ui/FolderPickerScreen";
import { HierarchySidebar } from "../../ui/HierarchySidebar";
import { TitleBar } from "../../ui/TitleBar";
import { WorkArea } from "../../ui/WorkArea";
import { FilePaneContainer } from "../fileTree/FilePaneContainer";
import type { FileTreeStore } from "../fileTree/fileTreeStore";
import type { ProjectTabsStore } from "./projectTabsStore";

interface Props {
  store: ProjectTabsStore;
  fileStore: FileTreeStore;
  /** 제목 표시줄 오른쪽에 창 버튼이 차지하는 폭 */
  captionWidth: number;
}

export function ProjectWorkspace({ store, fileStore, captionWidth }: Props) {
  const { status, state } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const current = activeTab(state);

  return (
    <div className="app">
      <TitleBar
        tabs={state.tabs}
        activeId={state.activeId}
        captionWidth={captionWidth}
        onSelect={(id) => void store.selectTab(id)}
        onClose={(id) => void store.closeTab(id)}
        onAdd={() => void store.addProject()}
      />
      {status === "disconnected" && (
        <p className="notice" role="status">
          코어와 연결이 끊겼습니다. 앱을 다시 실행해 주세요.
        </p>
      )}
      {status === "loading" ? (
        <main className="body" />
      ) : current ? (
        <main className="body body--project">
          <HierarchySidebar projectName={current.name}>
            <FilePaneContainer store={fileStore} />
          </HierarchySidebar>
          <WorkArea projectName={current.name} path={current.path} missing={current.missing} />
        </main>
      ) : (
        <main className="body">
          <FolderPickerScreen onPick={() => void store.addProject()} />
        </main>
      )}
    </div>
  );
}
