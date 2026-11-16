// 파일 칸 상태를 화면 조각에 연결한다.
import { useSyncExternalStore } from "react";
import { FilePane } from "../../ui/FilePane";
import type { FileTreeStore } from "./fileTreeStore";

interface Props {
  store: FileTreeStore;
}

export function FilePaneContainer({ store }: Props) {
  const { missing, tree } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <FilePane missing={missing} tree={tree} actions={store} />;
}
