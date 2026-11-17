// 터미널의 모양과 규칙. 코어가 보내주는 내용과 같다.

export interface TerminalInfo {
  id: string;
  tabId: string;
  /** 셸의 내부 이름 */
  shell: string;
  /** 터미널 줄에 표시할 이름. 예: "PowerShell 1" */
  name: string;
  /** 실행 중인 에이전트 이름. 없으면 빈 문자열 */
  agent: string;
  /** 셸 안에서 무언가 돌고 있음 */
  busy: boolean;
}

export interface TerminalOutput {
  id: string;
  bytes: Uint8Array;
}

export interface TerminalEvents {
  /** 터미널 목록이 바뀔 때마다 커지는 값 */
  version: number;
  terminals: TerminalInfo[];
  output: TerminalOutput[];
  /** 앱 닫기 확인을 요청받은 횟수. 커지면 확인 창을 띄운다 */
  quitRequests: number;
}

/** 터미널 하나의 글자 화면. 화면에 붙어 있지 않을 때도 출력을 받아 둔다 */
export interface TerminalScreen {
  /** 화면의 자리에 붙인다. null이면 뗀다. 같은 함수를 계속 쓴다 (React ref로 넘길 수 있다) */
  mount: (host: HTMLElement | null) => void;
  write(bytes: Uint8Array): void;
  dispose(): void;
}

export interface ScreenHandlers {
  /** 사용자가 터미널에 넣은 글자 */
  onInput(data: string): void;
  /** 화면 크기에 맞춰 가로·세로 글자 수가 바뀜 */
  onResize(columns: number, rows: number): void;
}

export type ScreenFactory = (handlers: ScreenHandlers) => TerminalScreen;

/** 실행 중인 프로그램이 있어 닫기 전에 묻는 대상 */
export type CloseQuestion = { kind: "terminal"; id: string } | { kind: "tab"; tabId: string } | { kind: "app" };

export const closeQuestionText = "실행 중인 프로그램이 있습니다. 닫으면 종료됩니다";

/** 터미널 줄을 읽어 주는 이름 */
export function terminalLabel(terminal: TerminalInfo): string {
  return terminal.agent ? `${terminal.name}, ${terminal.agent} 실행 중` : terminal.name;
}

/** 터미널을 띄우지 못한 이유. 폴더가 없는 경우는 작업 영역이 따로 알리므로 null */
export function terminalErrorMessage(code: string): string | null {
  switch (code) {
    case "folder_not_found":
    case "tab_not_found":
      return null;
    case "no_shell":
      return "터미널을 띄우지 못했습니다: 이 컴퓨터에서 쓸 수 있는 셸을 찾지 못했습니다";
    case "start_failed":
      return "터미널을 띄우지 못했습니다: 셸을 시작하지 못했습니다";
    default:
      return "터미널을 띄우지 못했습니다";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTerminal(value: unknown): value is TerminalInfo {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.tabId === "string" &&
    typeof value.shell === "string" &&
    typeof value.name === "string" &&
    typeof value.agent === "string" &&
    typeof value.busy === "boolean"
  );
}

/** 응답의 terminal 항목. 띄우지 않았으면 null, 모양이 다르면 undefined */
export function parseOpened(value: unknown): TerminalInfo | null | undefined {
  if (!isRecord(value)) return undefined;
  if (value.terminal === null) return null;
  return isTerminal(value.terminal) ? value.terminal : undefined;
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function parseTerminalEvents(value: unknown): TerminalEvents | undefined {
  if (
    !isRecord(value) ||
    typeof value.version !== "number" ||
    typeof value.quitRequests !== "number" ||
    !Array.isArray(value.terminals) ||
    !Array.isArray(value.output)
  ) {
    return undefined;
  }
  if (!value.terminals.every(isTerminal)) return undefined;
  const output: TerminalOutput[] = [];
  for (const chunk of value.output as unknown[]) {
    if (!isRecord(chunk) || typeof chunk.id !== "string" || typeof chunk.data !== "string") return undefined;
    output.push({ id: chunk.id, bytes: decodeBase64(chunk.data) });
  }
  return { version: value.version, terminals: value.terminals, output, quitRequests: value.quitRequests };
}
