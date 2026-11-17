// 터미널 하나의 글자 화면. 공개 부품 xterm.js로 그린다.
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import type { ScreenHandlers, TerminalScreen } from "../domain/terminals";

/** 지난 출력을 남겨 두는 줄 수 */
const SCROLLBACK_LINES = 5000;
/** 코어가 셸을 띄울 때 쓰는 크기와 같다. 화면에 붙으면 실제 크기로 다시 맞춘다 */
const START_COLUMNS = 120;
const START_ROWS = 30;
/** 글자 폭이 같은 Windows 기본 글꼴. 한글은 맑은 고딕으로 나온다 */
const FONT = '"Cascadia Mono", Consolas, "Malgun Gothic", monospace';

/** 색은 색상표(design/theme-kirin.css)의 토큰에서 읽는다 */
function themeFromTokens(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: token("--bg-1"),
    foreground: token("--text-1"),
    cursor: token("--ochre"),
    cursorAccent: token("--bg-1"),
    selectionBackground: token("--moss"),
    black: token("--term-black"),
    red: token("--term-red"),
    green: token("--term-green"),
    yellow: token("--term-yellow"),
    blue: token("--term-blue"),
    magenta: token("--term-magenta"),
    cyan: token("--term-cyan"),
    white: token("--term-white"),
    brightBlack: token("--term-bright-black"),
    brightRed: token("--term-bright-red"),
    brightGreen: token("--term-bright-green"),
    brightYellow: token("--term-bright-yellow"),
    brightBlue: token("--term-bright-blue"),
    brightMagenta: token("--term-bright-magenta"),
    brightCyan: token("--term-bright-cyan"),
    brightWhite: token("--term-bright-white"),
  };
}

export function createXtermScreen(handlers: ScreenHandlers): TerminalScreen {
  const terminal = new Terminal({
    cols: START_COLUMNS,
    rows: START_ROWS,
    scrollback: SCROLLBACK_LINES,
    fontFamily: FONT,
    fontSize: 13,
    cursorBlink: true,
    theme: themeFromTokens(),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);

  // 화면의 자리가 바뀌어도(다른 터미널을 봤다가 돌아와도) 이 요소를 그대로 옮겨 붙인다
  const holder = document.createElement("div");
  holder.className = "termview__screen";
  let opened = false;
  let observer: ResizeObserver | null = null;

  terminal.onData(handlers.onInput);
  terminal.onResize(({ cols, rows }) => handlers.onResize(cols, rows));

  // 글자 키는 물리 위치(code)와 글자(key) 어느 쪽으로든 알아본다 (한글 입력 상태, 화상 키보드)
  const isLetter = (event: KeyboardEvent, letter: string) =>
    event.code === `Key${letter}` || event.key.toUpperCase() === letter;

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown" || !event.ctrlKey || event.altKey) return true;
    // 선택한 글자가 있을 때의 Ctrl+C는 복사다. 없으면 실행 중인 프로그램을 멈추는 신호로 넘긴다
    if (isLetter(event, "C") && !event.shiftKey && terminal.hasSelection()) {
      void navigator.clipboard.writeText(terminal.getSelection()).catch(() => undefined);
      terminal.clearSelection();
      event.preventDefault();
      return false;
    }
    // Ctrl+V는 브라우저의 붙여넣기에 맡긴다. 붙여넣은 글자는 xterm이 받아 터미널로 보낸다
    if (isLetter(event, "V")) return false;
    return true;
  });

  return {
    mount: (host) => {
      observer?.disconnect();
      observer = null;
      if (!host) {
        holder.remove();
        return;
      }
      host.appendChild(holder);
      if (!opened) {
        terminal.open(holder);
        terminal.textarea?.setAttribute("aria-label", "터미널 입력");
        opened = true;
      }
      fit.fit();
      observer = new ResizeObserver(() => fit.fit());
      observer.observe(host);
      terminal.focus();
    },
    write: (bytes) => terminal.write(bytes),
    dispose: () => {
      observer?.disconnect();
      holder.remove();
      terminal.dispose();
    },
  };
}
