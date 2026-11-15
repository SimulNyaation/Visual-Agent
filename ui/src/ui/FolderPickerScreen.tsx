// 프로젝트 폴더 선택 화면. 열린 프로젝트가 없을 때 보인다.
interface Props {
  onPick(): void;
}

export function FolderPickerScreen({ onPick }: Props) {
  return (
    <section className="picker" aria-label="프로젝트 폴더 선택">
      <p className="picker__title">작업할 프로젝트 폴더를 골라 주세요</p>
      <p className="picker__hint">폴더 하나가 프로젝트 하나입니다.</p>
      <button type="button" className="picker__button" onClick={onPick}>
        폴더 선택
      </button>
    </section>
  );
}
