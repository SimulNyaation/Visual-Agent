// 터미널의 글자 화면을 흉내 내는 가짜. 받은 출력을 글자 그대로 보여 주기만 한다.
// 실제 글자 화면(색, 커서, 크기 맞춤, 복사·붙여넣기)은 앱 창 테스트가 확인한다.
import type { ScreenFactory, ScreenHandlers, TerminalScreen } from "../domain/terminals";

export interface FakeScreen extends TerminalScreen {
  /** 지금까지 받은 출력 */
  text(): string;
  /** 사용자가 이 터미널에 글자를 넣은 것처럼 만든다 */
  type(data: string): void;
  /** 화면 크기가 바뀌어 가로·세로 글자 수가 달라진 것처럼 만든다 */
  resize(columns: number, rows: number): void;
  disposed: boolean;
}

export function fakeScreens(): { create: ScreenFactory; all: FakeScreen[] } {
  const all: FakeScreen[] = [];
  const create = (handlers: ScreenHandlers): FakeScreen => {
    const decoder = new TextDecoder();
    const element = document.createElement("pre");
    element.className = "fake-screen";
    const screen: FakeScreen = {
      mount: (host) => {
        if (host) host.appendChild(element);
        else element.remove();
      },
      write(bytes) {
        element.textContent += decoder.decode(bytes, { stream: true });
      },
      dispose() {
        element.remove();
        screen.disposed = true;
      },
      text: () => element.textContent ?? "",
      type: (data) => handlers.onInput(data),
      resize: (columns, rows) => handlers.onResize(columns, rows),
      disposed: false,
    };
    all.push(screen);
    return screen;
  };
  return { create, all };
}
