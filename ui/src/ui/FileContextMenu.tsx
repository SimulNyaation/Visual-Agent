// 파일 칸의 우클릭 메뉴. 기린 테마로 직접 그린다.
export interface MenuItem {
  label: string;
  disabled?: boolean;
  onSelect(): void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
}

const ITEM_HEIGHT = 30;
const MENU_WIDTH = 168;
const MENU_PADDING = 6;

export function FileContextMenu({ x, y, items, onClose }: Props) {
  // 창 밖으로 넘치지 않게 자리를 당긴다
  const menuHeight = items.length * ITEM_HEIGHT + MENU_PADDING * 2;
  const left = Math.max(0, Math.min(x, window.innerWidth - MENU_WIDTH));
  const top = Math.max(0, Math.min(y, window.innerHeight - menuHeight));

  return (
    <>
      <div
        className="menu-backdrop"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="menu"
        role="menu"
        aria-label="파일 메뉴"
        style={{ left, top, width: MENU_WIDTH }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {items.map((item) => (
          <button
            key={item.label}
            role="menuitem"
            className="menu__item"
            disabled={item.disabled}
            aria-disabled={item.disabled ?? false}
            onClick={item.onSelect}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
