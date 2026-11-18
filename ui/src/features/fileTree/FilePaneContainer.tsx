// 파일 칸 상태를 화면 조각에 연결한다.
import { useSyncExternalStore } from "react";
import { FilePane } from "../../ui/FilePane";
import type { FileTreeStore } from "./fileTreeStore";

interface Props {
  store: FileTreeStore;
  /** 파일을 눌러 문서 창에 연다 */
  onOpen?(path: string): void;
}

export function FilePaneContainer({ store, onOpen }: Props) {
  const { missing, tree } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <FilePane missing={missing} tree={tree} actions={store} onOpen={onOpen} />;
}
