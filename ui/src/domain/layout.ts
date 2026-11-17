// 화면 배치의 모양과 규칙: 하이어라키 사이드바의 너비와, 에이전트 칸·파일 칸이 나눠 갖는 높이의 비율.

export interface Layout {
  /** 사이드바 너비 (px) */
  sidebarWidth: number;
  /** 두 칸의 높이 가운데 에이전트 칸의 몫 (0~1) */
  agentShare: number;
}

export const defaultLayout: Layout = { sidebarWidth: 240, agentShare: 0.5 };

export const narrowestSidebar = 180;
export const narrowestWorkArea = 320;
/** 칸 하나의 가장 작은 높이: 제목 줄(30) + 항목 두 줄(28 × 2) */
export const smallestPane = 86;
/** 방향키 한 번에 움직이는 거리 (px) */
export const nudgeStep = 16;

/** 사이드바는 180px보다 좁아지지 않고, 작업 영역이 320px보다 좁아질 만큼 넓어지지 않는다 */
export function clampSidebarWidth(width: number, windowWidth: number): number {
  const widest = Math.max(narrowestSidebar, windowWidth - narrowestWorkArea);
  return Math.round(Math.min(Math.max(width, narrowestSidebar), widest));
}

/** 어느 칸도 가장 작은 높이보다 작아지지 않게 한다. panesHeight는 두 칸의 높이를 더한 값 */
export function clampAgentShare(share: number, panesHeight: number): number {
  if (!(panesHeight > smallestPane * 2)) return defaultLayout.agentShare;
  const smallest = smallestPane / panesHeight;
  return Math.min(Math.max(share, smallest), 1 - smallest);
}

/** 코어의 응답이 약속한 모양인지 확인한다. 아니면 undefined */
export function parseLayout(value: unknown): Layout | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { sidebarWidth, agentShare } = value as Record<string, unknown>;
  if (typeof sidebarWidth !== "number" || typeof agentShare !== "number") return undefined;
  if (!Number.isFinite(sidebarWidth) || !Number.isFinite(agentShare)) return undefined;
  return { sidebarWidth, agentShare };
}
