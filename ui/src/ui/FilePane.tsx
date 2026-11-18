// 파일 칸. 프로젝트 폴더의 내부 구조를 보여주고, 옮기기·복사·이름 바꾸기·지우기·새로 만들기의 입력을 받는다.
import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import {
  ROOT,
  canDrop,
  parentOf,
  trashQuestion,
  type FileRow,
  type TreeState,
} from "../domain/fileTree";
import { FileContextMenu, type MenuItem } from "./FileContextMenu";

export interface FilePaneActions {
  toggleFolder(path: string): Promise<void>;
  setExpanded(path: string, expanded: boolean): Promise<void>;
  select(path: string, modifiers: { ctrl: boolean; shift: boolean }): void;
  openMenu(x: number, y: number, target: string | null): void;
  escape(): void;
  startCreate(kind: "file" | "folder", target: string | null): Promise<void>;
  submitCreate(name: string): Promise<void>;
  startRename(): void;
  submitRename(name: string): Promise<void>;
  cancelEdit(): void;
  requestTrash(): void;
  confirmTrash(): Promise<void>;
  cancelTrash(): void;
  copy(): void;
  cut(): void;
  paste(target?: string | null): Promise<void>;
  undo(): Promise<void>;
  dragStart(path: string): void;
  dragOver(folder: string | null): void;
  drop(folder: string): Promise<void>;
  dragEnd(): void;
  dismissNotice(): void;
}

interface Props {
  /** 탭의 폴더를 찾을 수 없음 */
  missing: boolean;
  tree: TreeState | null;
  actions: FilePaneActions;
  /** 파일을 눌러 문서 창에 연다 */
  onOpen?(path: string): void;
}

const ROW_HEIGHT = 26;
/** 화면 밖 위아래로 미리 그려 두는 줄 수 */
const OVERSCAN = 12;
/** 높이를 아직 재지 못했을 때 그릴 높이 */
const FALLBACK_HEIGHT = 800;
/** 줄이 칸을 가득 채워도 맨 아래에 남겨 두는 빈 곳. 여기에 놓거나 우클릭하면 프로젝트 폴더가 대상이 된다 */
const BLANK_TAIL = 40;

/** 이름 입력 칸이 뜰 때 확장자 앞까지만 선택해 둔다 */
function selectBaseName(input: HTMLInputElement | null) {
  if (!input) return;
  const dot = input.defaultValue.lastIndexOf(".");
  input.setSelectionRange(0, dot > 0 ? dot : input.defaultValue.length);
}

interface NameInputProps {
  label: string;
  initial: string;
  onSubmit(name: string): void;
  /** Esc로 그만둠 */
  onEscape(): void;
  /** 다른 곳을 눌러 입력 칸을 벗어남 */
  onLeave(): void;
}

function NameInput({ label, initial, onSubmit, onEscape, onLeave }: NameInputProps) {
  return (
    <input
      className="filerow__input"
      aria-label={label}
      defaultValue={initial}
      autoFocus
      spellCheck={false}
      ref={selectBaseName}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") onSubmit(event.currentTarget.value);
        else if (event.key === "Escape") onEscape();
      }}
      onBlur={onLeave}
    />
  );
}

function KindIcon({ kind }: { kind: FileRow["kind"] }) {
  return (
    <svg className={`filerow__icon filerow__icon--${kind}`} viewBox="0 0 16 16" aria-hidden="true">
      {kind === "file" ? (
        <path d="M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5v3.5h3.5" fill="none" stroke="currentColor" />
      ) : (
        <path
          d="M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z"
          fill={kind === "folder" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeDasharray={kind === "link" ? "2 1.5" : undefined}
        />
      )}
    </svg>
  );
}

export function FilePane({ missing, tree, actions, onOpen }: Props) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  // 칸의 높이를 재어, 보이는 만큼만 줄을 그린다
  const measure = useRef((element: HTMLDivElement | null) => {
    treeRef.current = element;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }).current;

  if (missing || tree?.rootMissing) {
    return <p className="pane__empty pane__empty--alert">폴더를 찾을 수 없습니다</p>;
  }
  if (!tree) return null;

  const { rows } = tree;
  const refocus = () => treeRef.current?.focus();
  // Esc로 그만둔 뒤에도 키보드가 파일 칸에 남아 있어야 F2, Ctrl+Z 등이 이어서 동작한다
  const cancelByKey = () => {
    actions.cancelEdit();
    refocus();
  };
  const editing = tree.renaming !== null || tree.draft !== null;
  const cutItems = tree.clipboard?.mode === "cut" ? tree.clipboard.items : [];

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const count = Math.ceil((height || FALLBACK_HEIGHT) / ROW_HEIGHT) + OVERSCAN * 2;
  const shown = rows.slice(first, first + count);

  const entryRows = rows.filter((row) => !row.draft);
  const cursorIndex = entryRows.findIndex((row) => row.path === tree.cursor);

  function moveCursor(index: number) {
    const row = entryRows[Math.max(0, Math.min(entryRows.length - 1, index))];
    if (!row) return;
    actions.select(row.path, { ctrl: false, shift: false });
    const element = treeRef.current;
    if (!element) return;
    const top = rows.indexOf(row) * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (editing || tree?.confirmTrash) return;
    const cursor = cursorIndex >= 0 ? entryRows[cursorIndex] : undefined;
    const ctrl = event.ctrlKey || event.metaKey;
    // 글자 키는 물리 위치(code)와 글자(key) 어느 쪽으로든 알아본다.
    // 한글 입력 상태에서는 글자가 달라지고, 화상 키보드나 원격 조작은 물리 위치 값을 보내지 않기 때문이다
    const letter = (name: string) => ctrl && (event.code === `Key${name}` || event.key.toUpperCase() === name);
    let handled = true;

    if (letter("Z")) void actions.undo();
    else if (letter("C")) actions.copy();
    else if (letter("X")) actions.cut();
    else if (letter("V")) void actions.paste();
    else if (event.key === "ArrowDown") moveCursor(cursorIndex + 1);
    else if (event.key === "ArrowUp") moveCursor(cursorIndex < 0 ? 0 : cursorIndex - 1);
    else if (event.key === "ArrowRight" && cursor?.kind === "folder") void actions.setExpanded(cursor.path, true);
    else if (event.key === "ArrowLeft" && cursor?.kind === "folder" && cursor.expanded) void actions.setExpanded(cursor.path, false);
    else if (event.key === "ArrowLeft" && cursor && parentOf(cursor.path) !== ROOT) {
      moveCursor(entryRows.findIndex((row) => row.path === parentOf(cursor.path)));
    } else if (event.key === "F2") actions.startRename();
    else if (event.key === "Delete") actions.requestTrash();
    else if (event.key === "Escape") actions.escape();
    else handled = false;

    if (handled) event.preventDefault();
  }

  /** 끌어 온 것을 이 줄에 놓으면 들어갈 폴더 */
  const dropFolder = (row: FileRow) => (row.kind === "folder" ? row.path : parentOf(row.path));

  function onDragOver(event: DragEvent, folder: string) {
    event.stopPropagation();
    if (!tree?.dragging) return;
    actions.dragOver(folder);
    if (canDrop(tree.dragging, folder)) event.preventDefault();
  }

  function onDrop(event: DragEvent, folder: string) {
    event.stopPropagation();
    if (!tree?.dragging) return;
    event.preventDefault();
    void actions.drop(folder);
  }

  function onContextMenu(event: MouseEvent, target: string | null) {
    event.preventDefault();
    event.stopPropagation();
    actions.openMenu(event.clientX, event.clientY, target);
  }

  function renderRow(row: FileRow) {
    const indent = { paddingLeft: 8 + row.depth * 14 };
    if (row.draft) {
      return (
        <div key="draft" className="filerow" style={indent}>
          <span className="filerow__twisty" />
          <KindIcon kind={row.kind} />
          <NameInput
            label={row.draft === "folder" ? "새 폴더 이름" : "새 파일 이름"}
            initial=""
            onSubmit={(name) => {
              void actions.submitCreate(name);
              refocus();
            }}
            onEscape={cancelByKey}
            onLeave={actions.cancelEdit}
          />
        </div>
      );
    }

    const selected = tree?.selected.has(row.path) ?? false;
    const classes = [
      "filerow",
      selected && "filerow--selected",
      row.path === tree?.cursor && "filerow--cursor",
      cutItems.includes(row.path) && "filerow--cut",
      row.kind === "folder" && tree?.dropTarget === row.path && "filerow--drop",
    ];
    return (
      <div
        key={row.path}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-selected={selected}
        aria-expanded={row.kind === "folder" ? row.expanded : undefined}
        aria-label={row.name}
        data-kind={row.kind}
        data-path={row.path}
        className={classes.filter(Boolean).join(" ")}
        style={indent}
        draggable={tree?.renaming !== row.path}
        onClick={(event) => {
          const ctrl = event.ctrlKey || event.metaKey;
          actions.select(row.path, { ctrl, shift: event.shiftKey });
          if (ctrl || event.shiftKey) return;
          if (row.kind === "folder") void actions.toggleFolder(row.path);
          else if (row.kind === "file") onOpen?.(row.path);
        }}
        onContextMenu={(event) => onContextMenu(event, row.path)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", row.name);
          actions.dragStart(row.path);
        }}
        onDragEnd={actions.dragEnd}
        onDragOver={(event) => onDragOver(event, dropFolder(row))}
        onDrop={(event) => onDrop(event, dropFolder(row))}
      >
        <span className="filerow__twisty" aria-hidden="true">
          {row.kind === "folder" ? (row.expanded ? "▾" : "▸") : ""}
        </span>
        <KindIcon kind={row.kind} />
        {tree?.renaming === row.path ? (
          <NameInput
            label="새 이름"
            initial={row.name}
            onSubmit={(name) => {
              void actions.submitRename(name);
              refocus();
            }}
            onEscape={cancelByKey}
            onLeave={actions.cancelEdit}
          />
        ) : (
          <span className="filerow__name">{row.name}</span>
        )}
      </div>
    );
  }

  const menu = tree.menu;
  const onRow = menu !== null && menu.target !== null;
  const many = tree.selected.size > 1;
  const run = (action: () => void) => () => {
    action();
    refocus();
  };
  const menuItems: MenuItem[] = menu
    ? [
        { label: "새 파일", onSelect: () => void actions.startCreate("file", menu.target) },
        { label: "새 폴더", onSelect: () => void actions.startCreate("folder", menu.target) },
        ...(onRow
          ? [
              { label: "잘라내기", onSelect: run(actions.cut) },
              { label: "복사", onSelect: run(actions.copy) },
            ]
          : []),
        {
          label: "붙여넣기",
          disabled: tree.clipboard === null,
          onSelect: run(() => void actions.paste(menu.target)),
        },
        ...(onRow
          ? [
              { label: "이름 바꾸기", disabled: many, onSelect: actions.startRename },
              { label: "지우기", onSelect: actions.requestTrash },
            ]
          : []),
      ]
    : [];

  return (
    <div className="filepane">
      <div
        ref={measure}
        role="tree"
        aria-label="파일"
        aria-multiselectable="true"
        tabIndex={0}
        className={tree.dropTarget === ROOT ? "filetree filetree--drop" : "filetree"}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => onContextMenu(event, null)}
        onDragOver={(event) => onDragOver(event, ROOT)}
        onDrop={(event) => onDrop(event, ROOT)}
      >
        <div className="filetree__rows" style={{ height: rows.length * ROW_HEIGHT + BLANK_TAIL }}>
          <div style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>{shown.map(renderRow)}</div>
        </div>
      </div>

      {tree.busy && (
        <p className="filenote filenote--busy" role="status">
          복사하는 중
        </p>
      )}
      {tree.notice && (
        <p className={`filenote filenote--${tree.notice.tone}`} role="status">
          <span className="filenote__text">{tree.notice.text}</span>
          <button className="filenote__close" aria-label="알림 닫기" onClick={run(actions.dismissNotice)}>
            ×
          </button>
        </p>
      )}

      {menu && <FileContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={run(actions.escape)} />}

      {tree.confirmTrash && (
        <div className="dialog-backdrop">
          <div
            className="dialog"
            role="alertdialog"
            aria-label="지우기 확인"
            onKeyDown={(event) => {
              if (event.key === "Escape") run(actions.cancelTrash)();
            }}
          >
            <p className="dialog__text">{trashQuestion(tree.confirmTrash)}</p>
            <div className="dialog__buttons">
              <button className="dialog__button" onClick={run(actions.cancelTrash)}>
                취소
              </button>
              <button
                className="dialog__button dialog__button--primary"
                autoFocus
                onClick={run(() => void actions.confirmTrash())}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
