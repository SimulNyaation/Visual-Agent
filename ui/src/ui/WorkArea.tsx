// 작업 영역. 지금은 비어 있고, 어느 프로젝트를 보고 있는지만 알려준다.
interface Props {
  projectName: string;
  path: string;
  missing: boolean;
}

export function WorkArea({ projectName, path, missing }: Props) {
  return (
    <section className="workarea" aria-label="작업 영역">
      {missing ? (
        <div className="workarea__empty">
          <p className="workarea__alert">폴더를 찾을 수 없습니다</p>
          <p className="workarea__path">{path}</p>
          <p className="workarea__hint">폴더가 지워졌거나 옮겨졌습니다. 탭의 ×를 눌러 닫을 수 있습니다.</p>
        </div>
      ) : (
        <div className="workarea__empty">
          <p>
            <span className="workarea__project">{projectName}</span> · 열린 창이 없습니다
          </p>
        </div>
      )}
    </section>
  );
}
