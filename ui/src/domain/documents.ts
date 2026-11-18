// 문서 창의 모양과 규칙. 파일 칸에서 누른 파일의 내용을 읽기 전용으로 보여 준다.

/** 그려서 보여 주는 방법 */
export type DocumentKind = "markdown" | "html" | "text";

export type DocumentContent =
  | { state: "loading" }
  | { state: "ready"; text: string; stamp: string }
  /** 열 수 없음. code는 코어가 알려 준 이유 */
  | { state: "error"; code: string };

export interface OpenDocument {
  /** 프로젝트 폴더 기준 경로 */
  path: string;
  /** 문서 탭에 표시할 파일 이름 */
  name: string;
  kind: DocumentKind;
  content: DocumentContent;
  /** 그려진 모습 대신 원문을 보고 있음 */
  raw: boolean;
}

/** 코어가 읽어 준 파일. text가 null이면 알고 있던 것과 같다 */
export interface FileRead {
  stamp: string;
  text: string | null;
}

/** 화면이 알고 있는 파일의 상태. 이것과 달라지면 다시 알려 달라고 코어에 말한다 */
export interface KnownFile {
  stamp?: string;
  error?: string;
}

/** 터미널과 문서 창이 저마다 지키는 가장 좁은 너비 */
export const narrowestPart = 240;
export const defaultDocumentShare = 0.5;
/** 방향키 한 번에 움직이는 거리 */
export const documentNudge = 16;

export function documentName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function documentKind(path: string): DocumentKind {
  const name = documentName(path).toLowerCase();
  if (/\.(md|markdown)$/.test(name)) return "markdown";
  if (/\.(html|htm)$/.test(name)) return "html";
  return "text";
}

/** 열 수 없는 이유를 사용자에게 보여 줄 글 */
export function documentErrorMessage(code: string): string {
  switch (code) {
    case "not_found":
    case "not_file":
      return "파일을 찾을 수 없습니다";
    case "tab_not_found":
    case "folder_not_found":
      return "프로젝트 폴더를 찾을 수 없습니다";
    case "not_text":
      return "글자 파일이 아니어서 보여 줄 수 없습니다";
    case "too_large":
      return "파일이 너무 커서 열지 않았습니다 (1MB 초과)";
    default:
      return "파일을 열지 못했습니다";
  }
}

/** 문서 창이 작업 영역에서 차지하는 몫. 문서 경계의 가로 위치로 정한다 */
export function documentShareAt(position: number, left: number, width: number): number {
  if (width < narrowestPart * 2) return defaultDocumentShare;
  const wanted = left + width - position;
  const clamped = Math.min(Math.max(wanted, narrowestPart), width - narrowestPart);
  return clamped / width;
}

/** 마크다운 안의 링크가 가리키는 프로젝트 안의 파일 경로. 웹 주소나 프로젝트 밖이면 null */
export function resolveLink(documentPath: string, href: string): string | null {
  if (href === "" || href.startsWith("#") || href.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  let target = href.replace(/[?#].*$/, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  target = target.replaceAll("\\", "/");
  const parts = target.startsWith("/") ? [] : documentPath.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length === 0 ? null : parts.join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseFileRead(value: unknown): FileRead | undefined {
  if (!isRecord(value) || typeof value.stamp !== "string" || typeof value.unchanged !== "boolean") return undefined;
  if (value.unchanged) return { stamp: value.stamp, text: null };
  return typeof value.text === "string" ? { stamp: value.stamp, text: value.text } : undefined;
}
