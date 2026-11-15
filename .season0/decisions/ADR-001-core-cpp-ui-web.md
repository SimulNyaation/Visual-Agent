# ADR-001: 코어는 C++, 화면은 웹 기술. 둘은 앱 안의 작은 웹 서버로 잇는다

- 일자: 2026-11-15
- 상태: Accepted
- 관련 명세: SPEC-20261115-app-skeleton (R2, AS1~AS5)

## Context
- PC·노트북(Windows)과 아이폰에서 같은 화면을 봐야 한다. Mac이 없어 아이폰은 브라우저로 접속한다.
- 머메이드·마크다운·HTML 문서를 화면에 그려야 하므로 웹 엔진이 필요하다.
- 혼자 쓰는 가벼운 도구여야 하고, 실행 파일을 복사하는 것만으로 다른 PC에서 돌아야 한다.

## Decision
코어(`core/`, C++20)가 실행 파일 안에서 127.0.0.1 전용 웹 서버(cpp-httplib)를 열고, 화면(`ui/`, TypeScript + React)은 그 서버에서 파일과 데이터를 받는다. PC의 앱 창은 Windows에 들어 있는 WebView2로 그 주소를 연다.

- 화면 → 코어 요청은 모두 `/api/…` 주소로 가고, 코어가 실행할 때마다 새로 만든 접속 값(`X-VA-Token`)이 있어야 한다. 접속 값은 앱 창이 화면에 직접 넣어 준다.
- 요청의 `Host`가 `127.0.0.1:<포트>`가 아니면 거부한다.
- 라이브러리는 vcpkg(`x64-windows-static`)로 받고, C++ 런타임까지 실행 파일에 넣는다(`/MT`).
- 개인 설정은 `%APPDATA%\Visual-Agent\state.json`, 화면 부품의 캐시는 `%LOCALAPPDATA%\Visual-Agent\WebView2`에 둔다.

## Alternatives Considered
| 대안 | 장점 | 단점 | 기각 사유 |
|---|---|---|---|
| 화면까지 C++ (Qt) | 한 언어 | 아이폰용 화면을 따로 만들어야 함. 문서 표시에 어차피 웹 엔진 필요 | 화면을 두 벌 만들게 됨 |
| Electron | 만들기 쉬움 | 브라우저를 통째로 포함해 무거움 | "가볍다" 요구(R5)와 충돌 |
| 앱 창은 WebView2 전용 통로(메시지), 원격만 웹 서버 | 서버 없이 시작 가능 | 같은 기능을 두 통로로 검증해야 함 | 원격 접속 명세에서 동작이 갈라짐 |
| WebSocket 서버 | 양방향 실시간 | 뼈대에는 코어가 먼저 알릴 일이 없음 | 필요해질 때(원격 접속) 서버 보내기 이벤트(SSE)부터 검토 |

## Consequences
- 화면 코드는 아이폰·노트북 원격 접속에서 그대로 재사용된다.
- 코어가 먼저 화면에 알려야 하는 기능(원격 기기의 탭 동기화)은 이 서버에 알림 통로를 추가해야 한다.
- 같은 PC의 다른 프로그램이 포트를 찾아 접속해도 접속 값 없이는 내용을 받지 못한다.
- 빌드에 Visual Studio Build Tools, vcpkg, Node.js가 필요하다. 실행에는 필요 없다.

## Enforcement
- 접속 값·Host 검사: `core/tests/api_server_test.cpp` ("접속 값이 없거나 틀리면…", "다른 주소 이름으로…")
- 화면에서 코어 주소·fetch를 `src/data/` 밖에 쓰지 못함: `ui/eslint.config.js` (`no-restricted-syntax`)
- 화면 계층 경계(ui → data 금지, domain 독립): `ui/eslint.config.js` (`no-restricted-imports`)
