import { ProjectWorkspace } from "../features/projectTabs/ProjectWorkspace";
import type { FileTreeStore } from "../features/fileTree/fileTreeStore";
import type { ProjectTabsStore } from "../features/projectTabs/projectTabsStore";
import type { TerminalStore } from "../features/terminals/terminalStore";

interface Props {
  store: ProjectTabsStore;
  fileStore: FileTreeStore;
  terminalStore: TerminalStore;
  captionWidth: number;
}

export function App({ store, fileStore, terminalStore, captionWidth }: Props) {
  return (
    <ProjectWorkspace store={store} fileStore={fileStore} terminalStore={terminalStore} captionWidth={captionWidth} />
  );
}
