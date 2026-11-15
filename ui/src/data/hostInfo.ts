// 앱 창이 화면에 알려주는 값. 브라우저로 직접 열면 없다.

interface HostInfo {
  /** 코어에 요청할 때 함께 보내는 접속 값 */
  token: string;
  /** 제목 표시줄 오른쪽에 창 버튼(최소화·최대화·닫기)이 차지하는 폭 */
  captionWidth: number;
}

declare global {
  interface Window {
    __VA__?: Partial<HostInfo>;
  }
}

export function readHostInfo(): HostInfo {
  const host = window.__VA__;
  return {
    token: typeof host?.token === "string" ? host.token : "",
    captionWidth: typeof host?.captionWidth === "number" ? host.captionWidth : 0,
  };
}
