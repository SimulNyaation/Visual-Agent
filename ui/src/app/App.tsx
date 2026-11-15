import { ProjectWorkspace } from "../features/projectTabs/ProjectWorkspace";
import type { ProjectTabsStore } from "../features/projectTabs/projectTabsStore";

interface Props {
  store: ProjectTabsStore;
  captionWidth: number;
}

export function App({ store, captionWidth }: Props) {
  return <ProjectWorkspace store={store} captionWidth={captionWidth} />;
}
