// 작업 영역. 터미널이 뜨는 자리다. 탭의 폴더를 찾을 수 없으면 그 안내만 보여 준다.
import type { ReactNode } from "react";

interface Props {
  path: string;
  missing: boolean;
  /** 폴더가 있을 때 보여 줄 내용 (터미널) */
  children: ReactNode;
}

export function WorkArea({ path, missing, children }: Props) {
  return (
    <section className="workarea" aria-label="작업 영역">
      {missing ? (
        <div className="workarea__empty">
          <p className="workarea__alert">폴더를 찾을 수 없습니다</p>
          <p className="workarea__path">{path}</p>
          <p className="workarea__hint">폴더가 지워졌거나 옮겨졌습니다. 탭의 ×를 눌러 닫을 수 있습니다.</p>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
