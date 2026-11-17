// 작업 영역에 뜨는 터미널. 터미널이 없으면 안내와 새 터미널 버튼을 보여 준다.
import type { TerminalScreen } from "../domain/terminals";

interface Props {
  terminalId: string | null;
  screen: TerminalScreen | null;
  /** 터미널을 띄우지 못한 이유 */
  error: string | null;
  onNew(): void;
}

export function TerminalArea({ terminalId, screen, error, onNew }: Props) {
  if (terminalId && screen) {
    // key가 바뀌면 자리가 새로 만들어지고, 그 터미널의 글자 화면이 옮겨 붙는다
    return <div key={terminalId} className="termview" role="group" aria-label="터미널" ref={screen.mount} />;
  }
  return (
    <div className="workarea__empty">
      {error && (
        <p className="workarea__alert" role="alert">
          {error}
        </p>
      )}
      <p>터미널이 없습니다</p>
      <button type="button" className="picker__button" onClick={onNew}>
        새 터미널
      </button>
    </div>
  );
}

interface ConfirmProps {
  text: string;
  onConfirm(): void;
  onCancel(): void;
}

/** 닫기 전에 묻는 확인 창 */
export function CloseConfirmDialog({ text, onConfirm, onCancel }: ConfirmProps) {
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-label="닫기 확인"
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      >
        <p className="dialog__text">{text}</p>
        <div className="dialog__buttons">
          <button type="button" className="dialog__button" autoFocus onClick={onCancel}>
            취소
          </button>
          <button type="button" className="dialog__button dialog__button--primary" onClick={onConfirm}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
