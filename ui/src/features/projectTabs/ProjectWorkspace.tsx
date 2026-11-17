// 프로젝트 탭 상태를 화면 조각들에 연결한다.
import { useSyncExternalStore } from "react";
import { activeTab } from "../../domain/projectTabs";
import { closeQuestionText } from "../../domain/terminals";
import { AgentPane, AgentTools } from "../../ui/AgentPane";
import { FolderPickerScreen } from "../../ui/FolderPickerScreen";
import { HierarchySidebar } from "../../ui/HierarchySidebar";
import { CloseConfirmDialog, TerminalArea } from "../../ui/TerminalArea";
import { TitleBar } from "../../ui/TitleBar";
import { WorkArea } from "../../ui/WorkArea";
import { FilePaneContainer } from "../fileTree/FilePaneContainer";
import type { FileTreeStore } from "../fileTree/fileTreeStore";
import type { TerminalStore } from "../terminals/terminalStore";
import type { ProjectTabsStore } from "./projectTabsStore";

interface Props {
  store: ProjectTabsStore;
  fileStore: FileTreeStore;
  terminalStore: TerminalStore;
  /** 제목 표시줄 오른쪽에 창 버튼이 차지하는 폭 */
  captionWidth: number;
}

export function ProjectWorkspace({ store, fileStore, terminalStore, captionWidth }: Props) {
  const { status, state } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const terminals = useSyncExternalStore(terminalStore.subscribe, terminalStore.getSnapshot);
  const current = activeTab(state);

  return (
    <div className="app">
      <TitleBar
        tabs={state.tabs}
        activeId={state.activeId}
        captionWidth={captionWidth}
        onSelect={(id) => void store.selectTab(id)}
        onClose={(id) => void terminalStore.closeTab(id)}
        onAdd={() => void store.addProject()}
      />
      {(status === "disconnected" || terminals.disconnected) && (
        <p className="notice" role="status">
          코어와 연결이 끊겼습니다. 앱을 다시 실행해 주세요.
        </p>
      )}
      {status === "loading" ? (
        <main className="body" />
      ) : current ? (
        <main className="body body--project">
          <HierarchySidebar
            projectName={current.name}
            agentTools={
              !current.missing && (
<AgentTools onNew={() => void terminalStore.open()} />
              )
            }
            agents={
              <AgentPane
                terminals={terminals.terminals}
                activeId={terminals.activeId}
                onSelect={terminalStore.select}
                onClose={(id) => void terminalStore.close(id)}
              />
            }
          >
            <FilePaneContainer store={fileStore} />
          </HierarchySidebar>
          <WorkArea path={current.path} missing={current.missing}>
            <TerminalArea
              terminalId={terminals.activeId}
              screen={terminals.screen}
              error={terminals.error}
              onNew={() => void terminalStore.open()}
            />
          </WorkArea>
        </main>
      ) : (
        <main className="body">
          <FolderPickerScreen onPick={() => void store.addProject()} />
        </main>
      )}
      {terminals.question && (
        <CloseConfirmDialog
          text={closeQuestionText}
          onConfirm={() => void terminalStore.confirm()}
          onCancel={() => void terminalStore.cancel()}
        />
      )}
    </div>
  );
}
