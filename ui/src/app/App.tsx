import { ProjectWorkspace } from "../features/projectTabs/ProjectWorkspace";
import type { FileTreeStore } from "../features/fileTree/fileTreeStore";
import type { LayoutStore } from "../features/layout/layoutStore";
import type { ProjectTabsStore } from "../features/projectTabs/projectTabsStore";
import type { TerminalStore } from "../features/terminals/terminalStore";

interface Props {
  store: ProjectTabsStore;
  fileStore: FileTreeStore;
  terminalStore: TerminalStore;
  layoutStore: LayoutStore;
  captionWidth: number;
}

export function App({ store, fileStore, terminalStore, layoutStore, captionWidth }: Props) {
  return (
    <ProjectWorkspace
      store={store}
      fileStore={fileStore}
      terminalStore={terminalStore}
      layoutStore={layoutStore}
      captionWidth={captionWidth}
    />
  );
}
