// 프로젝트 탭 상태를 화면 조각들에 연결한다.
import { useSyncExternalStore } from "react";
import { defaultDocumentShare } from "../../domain/documents";
import { activeTab } from "../../domain/projectTabs";
import { closeQuestionText } from "../../domain/terminals";
import { AgentPane, AgentTools } from "../../ui/AgentPane";
import { DocumentPane } from "../../ui/DocumentPane";
import { FolderPickerScreen } from "../../ui/FolderPickerScreen";
import { HierarchySidebar } from "../../ui/HierarchySidebar";
import { Splitter } from "../../ui/Splitter";
import { CloseConfirmDialog, TerminalArea } from "../../ui/TerminalArea";
import { TitleBar } from "../../ui/TitleBar";
import { WorkArea } from "../../ui/WorkArea";
import type { DocumentSnapshot, DocumentStore } from "../documents/documentStore";
import { FilePaneContainer } from "../fileTree/FilePaneContainer";
import type { FileTreeStore } from "../fileTree/fileTreeStore";
import type { LayoutStore } from "../layout/layoutStore";
import type { TerminalStore } from "../terminals/terminalStore";
import type { ProjectTabsStore } from "./projectTabsStore";

interface Props {
  store: ProjectTabsStore;
  fileStore: FileTreeStore;
  terminalStore: TerminalStore;
  layoutStore: LayoutStore;
  /** 문서 창. 주지 않으면 파일을 눌러도 열리지 않는다 */
  documentStore?: DocumentStore;
  /** 제목 표시줄 오른쪽에 창 버튼이 차지하는 폭 */
  captionWidth: number;
}

/** 사이드바 경계의 한계를 정하는 앱 창의 너비 */
const windowWidth = () => window.innerWidth;

const noDocuments: DocumentSnapshot = { documents: [], activePath: null, share: defaultDocumentShare };
const neverChanges = () => () => undefined;
const getNoDocuments = () => noDocuments;

/** 문서 경계가 놓인 작업 영역(터미널과 문서 창을 함께 담은 자리)의 위치와 너비 */
function splitBounds(boundary: HTMLElement) {
  const rect = boundary.parentElement?.getBoundingClientRect();
  return { left: rect?.left ?? 0, width: rect?.width ?? 0 };
}

export function ProjectWorkspace({ store, fileStore, terminalStore, layoutStore, documentStore, captionWidth }: Props) {
  const documents = useSyncExternalStore(documentStore?.subscribe ?? neverChanges, documentStore?.getSnapshot ?? getNoDocuments);
  const { status, state } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const terminals = useSyncExternalStore(terminalStore.subscribe, terminalStore.getSnapshot);
  const layout = useSyncExternalStore(layoutStore.subscribe, layoutStore.getSnapshot);
  const current = activeTab(state);

  return (
    <div className="app">
      <TitleBar
        tabs={state.tabs}
        activeId={state.activeId}
        captionWidth={captionWidth}
        attention={terminals.attentionTabs}
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
            width={layout.sidebarWidth}
            agentShare={layout.agentShare}
            onResizePanes={layoutStore.resizePanes}
            onResizePanesEnd={() => void layoutStore.save()}
            onNudgePanes={layoutStore.nudgePanes}
            onResetPanes={layoutStore.resetPanes}
            agentTools={!current.missing && <AgentTools onNew={() => void terminalStore.open()} />}
            agents={
              <AgentPane
                terminals={terminals.terminals}
                activeId={terminals.activeId}
                onSelect={terminalStore.select}
                onClose={(id) => void terminalStore.close(id)}
              />
            }
          >
            <FilePaneContainer store={fileStore} onOpen={documentStore?.open} />
          </HierarchySidebar>
          <Splitter
            orientation="vertical"
            label="사이드바 너비 조절"
            value={layout.sidebarWidth}
            onDrag={(position) => layoutStore.resizeSidebar(position, windowWidth())}
            onDragEnd={() => void layoutStore.save()}
            onNudge={(direction) => layoutStore.nudgeSidebar(direction, windowWidth())}
            onReset={layoutStore.resetSidebar}
          />
          <WorkArea path={current.path} missing={current.missing}>
            <div className="worksplit">
              <div className="worksplit__main">
                <TerminalArea
                  terminalId={terminals.activeId}
                  screen={terminals.screen}
                  error={terminals.error}
                  onNew={() => void terminalStore.open()}
                />
              </div>
              {documentStore && documents.documents.length > 0 && (
                <>
                  <Splitter
                    orientation="vertical"
                    label="문서 창 너비 조절"
                    value={Math.round(documents.share * 100)}
                    onDrag={(position, boundary) => documentStore.resize(position, splitBounds(boundary))}
                    onDragEnd={() => undefined}
                    onNudge={(direction, boundary) => documentStore.nudge(direction, splitBounds(boundary))}
                    onReset={documentStore.resetShare}
                  />
                  <DocumentPane
                    documents={documents.documents}
                    activePath={documents.activePath}
                    share={documents.share}
                    onSelect={documentStore.select}
                    onClose={documentStore.close}
                    onToggleRaw={documentStore.toggleRaw}
                    onOpen={documentStore.open}
                  />
                </>
              )}
            </div>
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
