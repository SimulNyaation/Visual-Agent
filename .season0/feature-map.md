# Feature Map

UI와 기능의 **정식 명칭** 사전입니다. Human과 AI가 동일한 명칭으로 소통하기 위한 기준입니다. 위치 묘사("왼쪽 영역") 대신 이 명칭을 사용합니다.

신규 화면·영역은 구현 시 함께 등록합니다.

## 페이지 / 씬

| 정식 명칭 | 라우트·씬 | 기능 | 주요 영역 |
|---|---|---|---|
| 앱 창 | `Visual-Agent.exe`의 창 | 프로젝트마다 탭으로 나뉜 작업 화면 | 제목 표시줄, 하이어라키 사이드바, 작업 영역 |
| 프로젝트 폴더 선택 화면 | 앱 창 (열린 프로젝트가 없을 때) | 프로젝트로 쓸 폴더를 고른다 | 폴더 선택 버튼 |

## 영역 / 컴포넌트

| 정식 명칭 | 소속 페이지 | 설명 | 코드 위치 |
|---|---|---|---|
| 제목 표시줄 | 앱 창 | 맨 위의 띠. 프로젝트 탭 줄, 프로젝트 추가(+), 창 버튼이 들어 있고 빈 곳을 끌면 창이 움직인다 | `ui/src/ui/TitleBar.tsx` |
| 프로젝트 탭 줄 | 제목 표시줄 | 열린 프로젝트의 탭이 늘어선 줄. 넘치면 좌우로 스크롤된다 | `ui/src/ui/TitleBar.tsx` |
| 프로젝트 탭 | 프로젝트 탭 줄 | 프로젝트 하나. 누르면 화면 전체가 그 프로젝트로 바뀐다 | `ui/src/ui/TitleBar.tsx`, 규칙: `core/src/domain/project_tabs.cpp` |
| 탭 닫기(×) | 프로젝트 탭 | 그 탭을 닫는다 | `ui/src/ui/TitleBar.tsx` |
| 프로젝트 추가(+) | 제목 표시줄 | 폴더 선택 창을 띄워 새 탭을 연다 | `ui/src/ui/TitleBar.tsx`, 폴더 선택 창: `core/src/app/app_window.cpp` |
| 창 버튼 | 제목 표시줄 | 최소화·최대화·닫기. 창 쪽에서 그린다 | `core/src/app/app_window.cpp` |
| 하이어라키 사이드바 | 앱 창 | 맨 위에 프로젝트 이름, 그 아래에 에이전트 칸과 파일 칸을 위아래로 둔다. 칸 제목을 누르면 그 칸이 접힌다 | `ui/src/ui/HierarchySidebar.tsx` |
| 사이드바 경계 | 하이어라키 사이드바와 작업 영역 사이 | 좌우로 끌면 사이드바의 너비가 바뀐다 (180px 이상, 작업 영역 320px는 남김). 더블클릭하면 240px로 돌아간다. 방향키로도 움직인다 | `ui/src/ui/Splitter.tsx`, 상태: `ui/src/features/layout/layoutStore.ts`, 규칙: `ui/src/domain/layout.ts` |
| 칸 경계 | 에이전트 칸과 파일 칸 사이 | 위아래로 끌면 두 칸이 나눠 갖는 높이의 비율이 바뀐다 (칸마다 제목 줄 + 항목 두 줄 이상). 더블클릭하면 반반으로 돌아간다. 한 칸이 접혀 있으면 없다 | `ui/src/ui/Splitter.tsx`, `ui/src/ui/HierarchySidebar.tsx` |
| 에이전트 칸 | 하이어라키 사이드바 | 그 프로젝트의 터미널이 한 줄씩 보인다. 터미널이 없으면 "터미널이 없습니다" | `ui/src/ui/AgentPane.tsx`, 상태: `ui/src/features/terminals/terminalStore.ts`, 규칙: `ui/src/domain/terminals.ts` |
| 터미널 줄 | 에이전트 칸 | 터미널 하나. 이름은 셸 이름과 번호("PowerShell 1"). 누르면 작업 영역이 그 터미널로 바뀐다. 에이전트가 돌고 있으면 에이전트 이름과 채운 점이 함께 보인다 | `ui/src/ui/AgentPane.tsx` |
| 터미널 이름 | 터미널 줄 | 에이전트와 나누는 대화의 주제. 에이전트에게 첫 질문을 보내면 그 질문이, 에이전트가 주제를 알려 주면 그 주제가 줄의 큰 글자가 되고, 아래에 작은 글자로 "에이전트 · 셸 이름과 번호"가 보인다. 에이전트가 끝나면 없어진다. 앱이 켜져 있는 동안만 기억한다 | 규칙: `ui/src/domain/terminalNames.ts`, 상태: `ui/src/features/terminals/terminalStore.ts`, `ui/src/ui/AgentPane.tsx` |
| 터미널 닫기(×) | 터미널 줄 | 그 터미널을 닫는다. 실행 중인 프로그램이 있으면 닫기 확인 창이 먼저 뜬다 | `ui/src/ui/AgentPane.tsx` |
| 새 터미널(+) | 에이전트 칸 제목 옆 | 터미널을 하나 더 띄운다. PowerShell 7로 뜨고, 뜨지 않으면 명령 프롬프트(cmd)로 뜬다 | `ui/src/ui/AgentPane.tsx` |
| 파일 칸 | 하이어라키 사이드바 | 프로젝트 폴더의 내부 구조. 펼치기·접기, 선택, 끌어서 옮기기, 복사·잘라내기·붙여넣기, 이름 바꾸기, 지우기, 새로 만들기, 되돌리기 | `ui/src/ui/FilePane.tsx`, 상태: `ui/src/features/fileTree/fileTreeStore.ts`, 규칙: `ui/src/domain/fileTree.ts` |
| 파일 줄 | 파일 칸 | 파일이나 폴더 하나. 누르면 선택되고 폴더는 펼쳐진다 | `ui/src/ui/FilePane.tsx` |
| 이름 입력 칸 | 파일 줄 | 이름 바꾸기와 새로 만들기에서 이름을 받는 칸. Enter로 반영, Esc로 그만둔다 | `ui/src/ui/FilePane.tsx` |
| 우클릭 메뉴 | 파일 칸 | 새 파일, 새 폴더, 잘라내기, 복사, 붙여넣기, 이름 바꾸기, 지우기. 빈 곳에서는 새 파일, 새 폴더, 붙여넣기만 | `ui/src/ui/FileContextMenu.tsx` |
| 지우기 확인 창 | 앱 창 | 지우기 전에 "…을 휴지통으로 보냅니다"를 묻는다 | `ui/src/ui/FilePane.tsx` |
| 파일 칸 알림 | 파일 칸 | 파일 칸 아래의 한 줄. 실패 이유, 되돌린 내용, "복사하는 중"을 표시한다 | `ui/src/ui/FilePane.tsx` |
| 작업 영역 | 앱 창 | 왼쪽에 터미널, 오른쪽에 문서 창이 나란히 놓인다. 문서를 열지 않았으면 터미널이 전부 쓴다. 코드 편집기도 여기에 뜰 예정 | `ui/src/ui/WorkArea.tsx`, `ui/src/features/projectTabs/ProjectWorkspace.tsx` |
| 터미널 | 작업 영역 | 셸에 명령을 넣고 결과를 보는 화면. 한 번에 하나만 보인다. 터미널이 없으면 "터미널이 없습니다"와 새 터미널 버튼 | `ui/src/ui/TerminalArea.tsx`, 글자 화면: `ui/src/ui/xtermScreen.ts` |
| 닫기 확인 창 | 앱 창 | 실행 중인 프로그램이 있는 터미널·프로젝트 탭·앱을 닫기 전에 "실행 중인 프로그램이 있습니다. 닫으면 종료됩니다"를 묻는다 | `ui/src/ui/TerminalArea.tsx` |
| 문서 창 | 작업 영역의 오른쪽 | 파일 칸에서 누른 파일의 내용을 읽기 전용으로 보여 준다. 마크다운·머메이드·HTML은 그려서, 그 밖의 글자 파일은 줄 번호와 함께 그대로. 파일이 바뀌면 따라 바뀐다. 열 수 없으면 이유를 보여 준다 | `ui/src/ui/DocumentPane.tsx`, 그리기: `ui/src/ui/markdownView.ts`, 상태: `ui/src/features/documents/documentStore.ts`, 규칙: `ui/src/domain/documents.ts` |
| 문서 탭 | 문서 창 위 | 열어 둔 문서마다 하나. 파일 이름이 적힌다. 누르면 그 문서가 보이고 ×로 닫는다. 마지막 문서를 닫으면 문서 창이 사라진다. 프로젝트 탭마다 따로다 | `ui/src/ui/DocumentPane.tsx` |
| 원문 버튼 | 문서 탭 줄의 오른쪽 | 마크다운·HTML 문서에서 그려진 모습과 파일에 적힌 글자 그대로를 오간다 | `ui/src/ui/DocumentPane.tsx` |
| 문서 경계 | 터미널과 문서 창 사이 | 좌우로 끌면 둘의 너비가 나뉜다 (각각 240px 이상). 더블클릭하면 반반으로 돌아간다. 앱을 다시 켜면 반반이다 | `ui/src/ui/Splitter.tsx`, `ui/src/domain/documents.ts` |
| 없어진 폴더 안내 | 작업 영역 | 탭의 폴더를 찾을 수 없을 때 표시 | `ui/src/ui/WorkArea.tsx` |
| 폴더 선택 버튼 | 프로젝트 폴더 선택 화면 | 폴더 선택 창을 띄운다 | `ui/src/ui/FolderPickerScreen.tsx` |

## 화면 밖 구성

| 정식 명칭 | 설명 | 코드 위치 |
|---|---|---|
| 코어 | 프로젝트 탭 상태를 관리하고 화면에 내용을 보내는 C++ 본체 | `core/src/` |
| 코어 서버 | 화면이 접속하는 앱 안의 웹 서버 | `core/src/server/api_server.cpp` |
| 개인 설정 저장소 | 열려 있던 탭을 기억하는 파일 | `core/src/data/settings_store.cpp` |
| 프로젝트 파일 작업 | 프로젝트 폴더 안에서 읽기·옮기기·복사·이름 바꾸기·새로 만들기를 하는 부분. 덮어쓰지 않는다 | `core/src/data/project_files.cpp`, 규칙: `core/src/domain/file_rules.cpp`, 요청 처리: `core/src/server/file_routes.cpp` |
| 휴지통 | 지운 것을 보내는 Windows 휴지통 | `core/src/data/recycle_bin.cpp` |
| 되돌리기 기록 | 프로젝트 탭마다 쌓이는, 되돌릴 수 있는 파일 작업 목록. 앱을 닫으면 사라진다 | `core/src/server/file_routes.cpp` |
| 폴더 변화 기다리기 | 펼쳐 둔 폴더가 앱 밖에서 바뀌면 화면에 알리는 부분 | `core/src/data/folder_watch.cpp` |
| 화면 배치 | 사이드바 너비와 두 칸의 높이 비율. 개인 설정 파일의 `layout` 항목에 저장되고 모든 프로젝트 탭에 똑같이 적용된다 | 규칙: `core/src/domain/layout.cpp`, 저장: `core/src/data/settings_store.cpp`, 요청 처리: `core/src/server/api_server.cpp` |
| 터미널 관리 | 셸을 띄우고 닫고, 글자를 주고받고, 실행 중인 에이전트를 알아보는 부분 | `core/src/data/terminals.cpp`, 셸 하나: `core/src/data/pty.cpp`, 규칙: `core/src/domain/terminal_rules.cpp`, 요청 처리: `core/src/server/terminal_routes.cpp` |
| 셸 찾기 | 터미널에 띄울 셸(PowerShell 7, 명령 프롬프트)이 이 컴퓨터의 어디에 있는지 찾는 부분 | `core/src/data/shell_finder.cpp` |
| 터미널 소식 | 화면이 받아 가는 터미널의 새 출력과 터미널 목록 | `core/src/server/terminal_routes.cpp` |
| 기린 테마 | 색상표. 터미널의 16색 포함 | `design/theme-kirin.css` |

## 상태 표시명 매핑

내부 식별자와 사용자 표시명이 다를 때 매핑합니다.

| 내부 식별자 | 사용자 표시명 | 비고 |
|---|---|---|
| `missing: true` | 폴더를 찾을 수 없습니다 | 프로젝트 탭의 폴더가 지워졌거나 옮겨짐 |
| `status: disconnected` | 코어와 연결이 끊겼습니다 | 화면이 코어의 응답을 받지 못함 |
| `rootMissing: true` | 폴더를 찾을 수 없습니다 | 열어 둔 프로젝트 폴더가 도중에 없어짐. 파일 칸에 표시 |
| `name_taken` | 같은 이름이 이미 있어 (옮기지/복사하지/이름을 바꾸지/만들지) 않았습니다 | 작업에 따라 문구가 다르다. `ui/src/domain/fileTree.ts` |
| `invalid_name` | 이 이름은 쓸 수 없습니다. … | Windows가 쓰지 못하는 글자나 이름 |
| `into_itself` | 폴더를 자기 자신 안으로는 옮길 수 없습니다 / 붙여넣을 수 없습니다 | |
| `in_use` | (작업)를 하지 못했습니다: 다른 프로그램이 쓰고 있는 파일이 있습니다 | |
| `not_found` | (작업)를 하지 못했습니다: 파일을 찾을 수 없습니다. … | 그 사이 옮겨졌거나 지워짐 |
| `no_trash` | 휴지통을 쓸 수 없는 위치라 지우지 않았습니다 | |
| `contains_link` | 다른 곳을 가리키는 연결 폴더는 복사할 수 없습니다 | |
| `nothing_to_undo` | 되돌릴 것이 없습니다 | |
| `undo_name_taken` | 되돌리지 못했습니다: 원래 자리에 같은 이름이 생겼습니다 | 그 작업은 기록에서 빠진다 |
| `undo_missing` | 되돌리지 못했습니다: 파일이 없어졌습니다 | 그 작업은 기록에서 빠진다 |
| `kind: link` | (점선 폴더 아이콘) | 다른 곳을 가리키는 연결 폴더. 펼쳐지지 않는다 |
| `clipboard.mode: cut` | (흐리게 표시) | 잘라내어 붙여넣기를 기다리는 항목 |
| `pwsh` / `cmd` | 터미널 줄: PowerShell / cmd + 번호 | PowerShell 7 / 명령 프롬프트. `core/src/domain/terminal_rules.cpp` |
| `agent: "Claude Code"` 등 | (에이전트 이름과 채운 점). 읽어 주는 이름은 "PowerShell 1, Claude Code 실행 중" | 그 터미널에서 에이전트가 돌고 있음 |
| `busy: true` | (표시 없음) | 셸 안에서 무언가 돌고 있음. 닫기 전에 확인을 묻는 기준 |
| `busy` (거절 이유) | 실행 중인 프로그램이 있습니다. 닫으면 종료됩니다 | 닫기 확인 창 |
| `no_shell` | 터미널을 띄우지 못했습니다: 이 컴퓨터에서 쓸 수 있는 셸을 찾지 못했습니다 | 작업 영역에 표시 |
| `start_failed` | 터미널을 띄우지 못했습니다: 셸을 시작하지 못했습니다 | |
