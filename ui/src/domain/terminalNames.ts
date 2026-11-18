// 터미널 줄의 이름을 정하는 규칙. 에이전트가 알려 준 주제가 있으면 주제, 없으면 첫 질문이 이름이 된다.

/** 이름으로 쓰는 글의 최대 길이. 줄에서는 어차피 잘려 보이고, 전체는 마우스를 올리면 보인다 */
const LONGEST_NAME = 200;
/** 넣고 있는 글을 기억해 두는 최대 길이 */
const LONGEST_DRAFT = 2000;

/** 터미널 하나의 이름 상태 */
export interface TerminalNaming {
  /** 사용자가 넣고 있는, 아직 보내지 않은 글 */
  draft: string;
  /** 붙여넣는 중 */
  pasting: boolean;
  /** 에이전트가 실행된 뒤 처음 보낸 질문 */
  question: string | null;
  /** 에이전트가 터미널 제목으로 알려 준 주제 */
  topic: string | null;
}

export const emptyNaming: TerminalNaming = { draft: "", pasting: false, question: null, topic: null };

/** 주제가 아닌 터미널 제목을 가려내는 데 쓰는 것들 */
export interface TitleContext {
  /** 실행 중인 에이전트의 이름. 예: "Claude Code" */
  agent: string;
  /** 프로젝트 폴더 이름 */
  folder: string;
}

/** 에이전트가 시작 화면에서 제목으로 보내는 자기 이름과 실행 명령 */
const AGENT_WORDS = new Set(["claude", "claude code", "codex", "codex cli", "openai codex", "gemini", "gemini cli", "aider", "opencode", "cursor agent", "copilot", "github copilot"]);

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

function tidy(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > LONGEST_NAME ? one.slice(0, LONGEST_NAME) : one;
}

function looksLikePath(text: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(text) || /^[~.]?[\\/]/.test(text) || /\.(exe|cmd|bat|ps1)$/i.test(text);
}

/** 터미널 제목이 대화의 주제이면 그 주제를, 아니면 null을 돌려준다 */
export function topicFromTitle(title: string, context: TitleContext): string | null {
  // 에이전트가 앞에 붙이는 장식 기호(진행 표시 등)는 뺀다
  const text = tidy(title.replace(/^[^\p{L}\p{N}]+/u, ""));
  if (text === "" || looksLikePath(tidy(title))) return null;
  const lower = text.toLowerCase();
  if (AGENT_WORDS.has(lower) || lower === context.agent.toLowerCase()) return null;
  if (context.folder !== "" && lower === context.folder.toLowerCase()) return null;
  return text;
}

/** 보낸 글이 질문이면 이름으로 쓸 모양으로 다듬어 돌려준다. 에이전트 명령(/help 등)과 빈 입력은 null */
export function questionFromLine(line: string): string | null {
  const text = tidy(line);
  // 한 글자짜리는 "y" 같은 확인 답이다
  if (text.length < 2 || text.startsWith("/")) return null;
  return text;
}

function dropLast(text: string): string {
  return Array.from(text).slice(0, -1).join("");
}

/** 사용자가 터미널에 넣은 글자를 따라가며, Enter로 보낸 글을 알아낸다 */
export function followInput(naming: TerminalNaming, data: string): { naming: TerminalNaming; sent: string[] } {
  let draft = naming.draft;
  let pasting = naming.pasting;
  const sent: string[] = [];
  const add = (text: string) => {
    if (draft.length < LONGEST_DRAFT) draft += text;
  };

  let index = 0;
  while (index < data.length) {
    if (pasting) {
      const end = data.indexOf(PASTE_END, index);
      add(data.slice(index, end === -1 ? data.length : end).replace(/[\r\n]+/g, " "));
      if (end === -1) break;
      pasting = false;
      index = end + PASTE_END.length;
      continue;
    }
    if (data.startsWith(PASTE_START, index)) {
      pasting = true;
      index += PASTE_START.length;
      continue;
    }
    const char = data.charAt(index);
    if (char === "\x1b") {
      const next = data[index + 1];
      if (next === "[") {
        // 화살표 같은 조작 키. 끝 글자까지 건너뛴다
        let end = index + 2;
        while (end < data.length && !/[@-~]/.test(data.charAt(end))) end++;
        index = end + 1;
      } else if (next === "O") {
        index += 3;
      } else if (next === "\r" || next === "\n") {
        // 줄바꿈 넣기 (Alt+Enter)
        add(" ");
        index += 2;
      } else {
        index += next === undefined ? 1 : 2;
      }
      continue;
    }
    index++;
    if (char === "\r") {
      if (draft.endsWith("\\")) {
        // 에이전트에서 \ 뒤의 Enter는 보내기가 아니라 줄바꿈이다
        draft = `${draft.slice(0, -1)} `;
      } else {
        sent.push(draft);
        draft = "";
      }
    } else if (char === "\n") {
      add(" ");
    } else if (char === "\x7f" || char === "\b") {
      draft = dropLast(draft);
    } else if (char === "\x03" || char === "\x15") {
      // Ctrl+C, Ctrl+U: 넣던 글을 지운다
      draft = "";
    } else if (char >= " ") {
      add(char);
    }
  }
  return { naming: { ...naming, draft, pasting }, sent };
}

/** 줄에 표시할 이름. 정해진 것이 없으면 null (터미널의 원래 이름을 쓴다) */
export function displayName(naming: TerminalNaming | undefined): string | null {
  return naming?.topic ?? naming?.question ?? null;
}
