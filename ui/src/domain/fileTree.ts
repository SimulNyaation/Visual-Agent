// 파일 칸의 모양과 규칙. 경로는 프로젝트 폴더에서 시작하는 "a/b/c" 꼴이고, 빈 글은 프로젝트 폴더 자신이다.

export type EntryKind = "folder" | "file" | "link";

export interface FileEntry {
  name: string;
  kind: EntryKind;
}

/** 폴더 하나의 내용. 코어가 보내주는 내용과 같다 */
export interface FolderListing {
  path: string;
  /** 폴더가 없어졌거나 읽을 수 없음 */
  missing: boolean;
  /** 내용이 같으면 같은 값 */
  stamp: string;
  entries: FileEntry[];
}

export interface FileChange {
  from: string;
  to: string;
}

export type FileOperationKind = "move" | "rename" | "create" | "copy";

export interface UndoneOperation {
  kind: FileOperationKind;
  items: FileChange[];
}

/** 이름을 입력받는 중인 새 파일·새 폴더 */
export interface Draft {
  parent: string;
  kind: "file" | "folder";
}

/** 파일 칸에 보이는 한 줄 */
export interface FileRow {
  path: string;
  name: string;
  kind: EntryKind;
  depth: number;
  expanded: boolean;
  /** 이름 입력 칸만 있는 줄 (새로 만들기) */
  draft?: "file" | "folder";
}

// ── 파일 칸이 화면에 보여줄 상태

export interface Notice {
  tone: "info" | "error";
  text: string;
}

export interface Clipboard {
  mode: "copy" | "cut";
  items: string[];
}

export interface MenuState {
  x: number;
  y: number;
  /** 우클릭한 줄. 빈 곳이면 null */
  target: string | null;
}

export interface TreeState {
  dirs: ReadonlyMap<string, FolderListing>;
  expanded: ReadonlySet<string>;
  rows: readonly FileRow[];
  selected: ReadonlySet<string>;
  /** 키보드가 가리키는 줄 */
  cursor: string | null;
  /** Shift로 범위를 고를 때의 시작 줄 */
  anchor: string | null;
  clipboard: Clipboard | null;
  renaming: string | null;
  draft: Draft | null;
  menu: MenuState | null;
  /** 지우기 전에 확인을 기다리는 항목 */
  confirmTrash: readonly string[] | null;
  notice: Notice | null;
  /** 붙여넣기(복사)가 진행 중 */
  busy: boolean;
  dragging: readonly string[] | null;
  /** 끌어 온 것을 놓으면 들어갈 폴더 */
  dropTarget: string | null;
  rootMissing: boolean;
}

export const ROOT = "";

export function joinPath(parent: string, name: string): string {
  return parent === ROOT ? name : `${parent}/${name}`;
}

export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? ROOT : path.slice(0, slash);
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** inner가 outer와 같거나 outer 안에 있는지. Windows처럼 대소문자를 구분하지 않는다 */
export function isSameOrInside(inner: string, outer: string): boolean {
  if (outer === ROOT) return true;
  const a = inner.toLowerCase();
  const b = outer.toLowerCase();
  return a === b || a.startsWith(`${b}/`);
}

/** 펼쳐진 폴더를 따라 내려가며 화면에 보일 줄을 차례로 만든다 */
export function visibleRows(
  dirs: ReadonlyMap<string, FolderListing>,
  expanded: ReadonlySet<string>,
  draft: Draft | null,
): FileRow[] {
  const rows: FileRow[] = [];
  const walk = (folder: string, depth: number) => {
    if (draft && draft.parent === folder) {
      rows.push({ path: joinPath(folder, ""), name: "", kind: draft.kind, depth, expanded: false, draft: draft.kind });
    }
    for (const entry of dirs.get(folder)?.entries ?? []) {
      const path = joinPath(folder, entry.name);
      const open = entry.kind === "folder" && expanded.has(path);
      rows.push({ path, name: entry.name, kind: entry.kind, depth, expanded: open });
      if (open) walk(path, depth + 1);
    }
  };
  walk(ROOT, 0);
  return rows;
}

/** Shift로 고를 때: 두 줄 사이의 모든 줄 */
export function rangeBetween(rows: readonly FileRow[], from: string, to: string): string[] {
  const entries = rows.filter((row) => !row.draft);
  const a = entries.findIndex((row) => row.path === from);
  const b = entries.findIndex((row) => row.path === to);
  if (a < 0 || b < 0) return b >= 0 ? [to] : [];
  return entries.slice(Math.min(a, b), Math.max(a, b) + 1).map((row) => row.path);
}

/** 새로 만들거나 붙여넣을 폴더: 폴더를 가리키면 그 안, 파일을 가리키면 그 파일이 있는 폴더, 아무것도 아니면 프로젝트 폴더 */
export function folderFor(rows: readonly FileRow[], path: string | null): string {
  if (path === null) return ROOT;
  const row = rows.find((candidate) => candidate.path === path);
  if (!row) return ROOT;
  return row.kind === "folder" ? row.path : parentOf(row.path);
}

/** 끌어 온 것을 이 폴더에 놓을 수 있는지: 자기 자신이나 자기 안이 아니고, 이미 모두 그 폴더에 있는 것도 아니어야 한다 */
export function canDrop(items: readonly string[], folder: string): boolean {
  if (items.length === 0) return false;
  if (items.some((item) => isSameOrInside(folder, item))) return false;
  return items.some((item) => parentOf(item).toLowerCase() !== folder.toLowerCase());
}

/** 옮기거나 이름을 바꾼 뒤, 그 안을 가리키던 경로들을 새 자리로 고친다 */
export function remapPath(path: string, changes: readonly FileChange[]): string {
  for (const change of changes) {
    if (change.from === ROOT) continue;
    if (path === change.from) return change.to;
    if (path.startsWith(`${change.from}/`)) return change.to + path.slice(change.from.length);
  }
  return path;
}

export type FileAction = "move" | "copy" | "rename" | "create" | "trash" | "undo" | "paste";

const actionNames: Record<FileAction, string> = {
  move: "옮기기",
  copy: "복사",
  paste: "붙여넣기",
  rename: "이름 바꾸기",
  create: "새로 만들기",
  trash: "지우기",
  undo: "되돌리기",
};

const nameTaken: Record<FileAction, string> = {
  move: "같은 이름이 이미 있어 옮기지 않았습니다",
  paste: "같은 이름이 이미 있어 옮기지 않았습니다",
  copy: "같은 이름이 이미 있어 복사하지 않았습니다",
  rename: "같은 이름이 이미 있어 이름을 바꾸지 않았습니다",
  create: "같은 이름이 이미 있어 만들지 않았습니다",
  trash: "같은 이름이 이미 있습니다",
  undo: "되돌리지 못했습니다: 원래 자리에 같은 이름이 생겼습니다",
};

/** 코어가 알려준 실패 이유를 화면에 보일 글로 바꾼다 */
export function fileErrorMessage(action: FileAction, code: string): string {
  switch (code) {
    case "name_taken":
      return nameTaken[action];
    case "invalid_name":
      return '이 이름은 쓸 수 없습니다. \\ / : * ? " < > | 는 넣을 수 없고, 점이나 빈칸으로 끝날 수 없습니다';
    case "into_itself":
      return action === "move"
        ? "폴더를 자기 자신 안으로는 옮길 수 없습니다"
        : "폴더를 자기 자신 안에는 붙여넣을 수 없습니다";
    case "in_use":
      return `${actionNames[action]}를 하지 못했습니다: 다른 프로그램이 쓰고 있는 파일이 있습니다`;
    case "not_found":
      return `${actionNames[action]}를 하지 못했습니다: 파일을 찾을 수 없습니다. 이미 옮겨졌거나 지워졌습니다`;
    case "no_trash":
      return "휴지통을 쓸 수 없는 위치라 지우지 않았습니다";
    case "contains_link":
      return "다른 곳을 가리키는 연결 폴더는 복사할 수 없습니다";
    case "nothing_to_undo":
      return "되돌릴 것이 없습니다";
    case "undo_name_taken":
      return "되돌리지 못했습니다: 원래 자리에 같은 이름이 생겼습니다";
    case "undo_missing":
      return "되돌리지 못했습니다: 파일이 없어졌습니다";
    case "folder_not_found":
      return "폴더를 찾을 수 없습니다";
    default:
      return `${actionNames[action]}를 하지 못했습니다`;
  }
}

function describe(paths: readonly string[]): string {
  const first = nameOf(paths[0] ?? "");
  return paths.length > 1 ? `${first} 외 ${paths.length - 1}개` : first;
}

/** 무엇을 되돌렸는지 한 줄로 */
export function undoMessage(undone: UndoneOperation): string {
  const targets = undone.items.map((item) => item.to);
  const first = undone.items[0];
  if (!first) return "되돌렸습니다";
  switch (undone.kind) {
    case "move": {
      const folder = parentOf(first.to);
      const where = folder === ROOT ? "프로젝트 폴더" : nameOf(folder);
      return `되돌림: ${describe(undone.items.map((item) => item.from))}를 ${where}로 옮긴 것`;
    }
    case "rename":
      return `되돌림: ${nameOf(first.from)}의 이름을 ${nameOf(first.to)}로 바꾼 것`;
    case "create":
      return `되돌림: ${describe(targets)}를 새로 만든 것`;
    case "copy":
      return `되돌림: ${describe(targets)}를 붙여넣은 것`;
  }
}

/** 지우기 전에 묻는 글 */
export function trashQuestion(paths: readonly string[]): string {
  return paths.length === 1
    ? `${nameOf(paths[0] ?? "")}을 휴지통으로 보냅니다`
    : `${paths.length}개를 휴지통으로 보냅니다`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEntry(value: unknown): value is FileEntry {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.kind === "folder" || value.kind === "file" || value.kind === "link")
  );
}

function isListing(value: unknown): value is FolderListing {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.missing === "boolean" &&
    typeof value.stamp === "string" &&
    Array.isArray(value.entries) &&
    value.entries.every(isEntry)
  );
}

function isChange(value: unknown): value is FileChange {
  return isRecord(value) && typeof value.from === "string" && typeof value.to === "string";
}

/** 코어의 응답이 약속한 모양인지 확인한다. 아니면 undefined */
export function parseListings(value: unknown): FolderListing[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.dirs) || !value.dirs.every(isListing)) return undefined;
  return value.dirs;
}

export function parseChanges(value: unknown): FileChange[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.changes) || !value.changes.every(isChange)) return undefined;
  return value.changes;
}

export function parseUndone(value: unknown): UndoneOperation | undefined {
  if (!isRecord(value) || !isRecord(value.undone)) return undefined;
  const { kind, items } = value.undone;
  if (kind !== "move" && kind !== "rename" && kind !== "create" && kind !== "copy") return undefined;
  if (!Array.isArray(items) || !items.every(isChange)) return undefined;
  return { kind, items };
}

export function parseErrorCode(value: unknown): string {
  return isRecord(value) && typeof value.error === "string" ? value.error : "failed";
}
