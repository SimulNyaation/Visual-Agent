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
| 에이전트 칸 | 하이어라키 사이드바 | 에이전트 목록과 상태가 들어갈 자리. 지금은 "에이전트가 없습니다"만 | `ui/src/ui/HierarchySidebar.tsx` |
| 파일 칸 | 하이어라키 사이드바 | 프로젝트 폴더의 내부 구조. 펼치기·접기, 선택, 끌어서 옮기기, 복사·잘라내기·붙여넣기, 이름 바꾸기, 지우기, 새로 만들기, 되돌리기 | `ui/src/ui/FilePane.tsx`, 상태: `ui/src/features/fileTree/fileTreeStore.ts`, 규칙: `ui/src/domain/fileTree.ts` |
| 파일 줄 | 파일 칸 | 파일이나 폴더 하나. 누르면 선택되고 폴더는 펼쳐진다 | `ui/src/ui/FilePane.tsx` |
| 이름 입력 칸 | 파일 줄 | 이름 바꾸기와 새로 만들기에서 이름을 받는 칸. Enter로 반영, Esc로 그만둔다 | `ui/src/ui/FilePane.tsx` |
| 우클릭 메뉴 | 파일 칸 | 새 파일, 새 폴더, 잘라내기, 복사, 붙여넣기, 이름 바꾸기, 지우기. 빈 곳에서는 새 파일, 새 폴더, 붙여넣기만 | `ui/src/ui/FileContextMenu.tsx` |
| 지우기 확인 창 | 앱 창 | 지우기 전에 "…을 휴지통으로 보냅니다"를 묻는다 | `ui/src/ui/FilePane.tsx` |
| 파일 칸 알림 | 파일 칸 | 파일 칸 아래의 한 줄. 실패 이유, 되돌린 내용, "복사하는 중"을 표시한다 | `ui/src/ui/FilePane.tsx` |
| 작업 영역 | 앱 창 | 문서 창과 코드 편집기가 뜰 자리. 지금은 비어 있음 | `ui/src/ui/WorkArea.tsx` |
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
| 기린 테마 | 색상표 | `design/theme-kirin.css` |

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
