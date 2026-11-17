// 두 영역 사이의 경계. 끌거나 방향키를 눌러 양쪽 크기를 바꾸고, 더블클릭하면 처음 값으로 돌아간다.
import type { KeyboardEvent } from "react";

interface Props {
  /** vertical: 좌우 영역 사이의 세로 경계 (좌우로 끈다). horizontal: 위아래 영역 사이의 가로 경계 (위아래로 끈다) */
  orientation: "vertical" | "horizontal";
  label: string;
  /** 지금 값 (읽어 주는 프로그램용) */
  value: number;
  /** 끄는 동안 계속 불린다. position은 창 안에서의 마우스 위치 (세로 경계는 가로 위치, 가로 경계는 세로 위치) */
  onDrag(position: number, element: HTMLElement): void;
  /** 끌기가 끝남 */
  onDragEnd(): void;
  /** 방향키. direction은 -1(왼쪽·위) 또는 1(오른쪽·아래) */
  onNudge(direction: number, element: HTMLElement): void;
  onReset(): void;
}

export function Splitter({ orientation, label, value, onDrag, onDragEnd, onNudge, onReset }: Props) {
  const keys = orientation === "vertical" ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const direction = (keys as Record<string, number | undefined>)[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    onNudge(direction, event.currentTarget);
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      className={`splitter splitter--${orientation}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // 끄는 동안 글자가 선택되지 않게 하고, 마우스가 터미널이나 창 밖으로 나가도 계속 따라오게 붙잡아 둔다
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onDrag(orientation === "vertical" ? event.clientX : event.clientY, event.currentTarget);
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onDragEnd();
      }}
      onDoubleClick={onReset}
      onKeyDown={handleKey}
    />
  );
}
