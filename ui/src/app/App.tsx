import { ProjectWorkspace } from "../features/projectTabs/ProjectWorkspace";
import type { DocumentStore } from "../features/documents/documentStore";
import type { FileTreeStore } from "../features/fileTree/fileTreeStore";
import type { LayoutStore } from "../features/layout/layoutStore";
import type { ProjectTabsStore } from "../features/projectTabs/projectTabsStore";
import type { TerminalStore } from "../features/terminals/terminalStore";

interface Props {
  store: ProjectTabsStore;
  fileStore: FileTreeStore;
  terminalStore: TerminalStore;
  layoutStore: LayoutStore;
  documentStore: DocumentStore;
  captionWidth: number;
}

export function App({ store, fileStore, terminalStore, layoutStore, documentStore, captionWidth }: Props) {
  return (
    <ProjectWorkspace
      store={store}
      fileStore={fileStore}
      terminalStore={terminalStore}
      layoutStore={layoutStore}
      documentStore={documentStore}
      captionWidth={captionWidth}
    />
  );
}
