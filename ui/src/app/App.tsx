import { ProjectWorkspace } from "../features/projectTabs/ProjectWorkspace";
import type { FileTreeStore } from "../features/fileTree/fileTreeStore";
import type { ProjectTabsStore } from "../features/projectTabs/projectTabsStore";

interface Props {
  store: ProjectTabsStore;
  fileStore: FileTreeStore;
  captionWidth: number;
}

export function App({ store, fileStore, captionWidth }: Props) {
  return <ProjectWorkspace store={store} fileStore={fileStore} captionWidth={captionWidth} />;
}
