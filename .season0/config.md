# Season0 Config

## 프레임워크
- 버전: 0.2
- 원본 위치: `../Season0-framework`

## 도메인 구성
- web — 화면(`ui/`)에 적용
- social — SNS 스튜디오 명세부터 적용

## 명세 위치
명세와 검증 보고서는 `private/specs/<ID>/`에 둔다. 대화 원문이 들어가므로 공개 저장소에 올리지 않는다. `.season0/specs/`에는 양식만 둔다.

## 품질 게이트
모든 변경이 통과해야 하는 단일 명령. 저장소 루트에서 실행한다.

```
npm run check
```

스크립트 인코딩 검사 → 화면 타입 검사 → 화면 린트 → 색상표 검사 → 화면 테스트 → 코어 파일 규칙 검사 → 화면 빌드 → 코어 빌드 → 코어 테스트 → 실행 파일 묶기 → 앱 창 테스트 순으로 돌고, 하나라도 실패하면 멈춘다. 마지막 단계에서 실제 앱 창이 여러 번, 합쳐 2분쯤 떴다가 닫힌다. 앱 창 테스트는 마우스 커서를 움직이지 않고, Windows 클립보드를 건드리지 않으며, 지운 파일을 실제 휴지통이 아닌 임시 폴더로 보낸다. 코어 테스트와 앱 창 테스트는 실제 셸(명령 프롬프트, PowerShell)을 띄운다.

베이스라인 파일: 없음

필요한 도구: Visual Studio Build Tools 2022(C++, CMake 도구 포함), vcpkg(`%USERPROFILE%\vcpkg` 또는 `VCPKG_ROOT`), Node.js. 처음 한 번 `ui/`에서 `npm install`.

제목 표시줄, 창 버튼, 창 틀을 바꾼 변경과 파일 칸·터미널·경계의 마우스·키보드 입력(복사·붙여넣기 포함)을 바꾼 변경은 품질 게이트에 더해 `npm run e2e:mouse`도 통과해야 한다. 품질 게이트의 앱 창 테스트는 창에 신호를 보내거나 화면 안으로 입력을 넣어 주는 방식이라 실제 클릭과 실제 키 입력이 도달하는지는 확인하지 못한다.

## 실행·증적 수집 명령

| 용도 | 명령 |
|---|---|
| 앱만 빌드 | `npm run build` → `build/dist/Visual-Agent/` |
| 앱 실행 | `npm start` 또는 `build\dist\Visual-Agent\Visual-Agent.exe` |
| 앱 창 테스트 | `cd ui && npm run e2e` |
| 앱 창 테스트 + 스크린샷 | `VA_EVIDENCE_DIR=<폴더>`를 정하고 `npm run e2e` |
| 실제 마우스·키보드로 창 버튼·창 다루기·파일 칸·터미널·크기 조절 테스트 | `cd ui && npm run e2e:mouse` (커서가 움직이고 키가 눌리며 클립보드의 글자가 잠깐 바뀐다. 2분쯤 걸리며 도는 동안 마우스와 키보드를 건드리지 않는다. 다른 창을 누르면 "app window is not in front"로 실패한다) |
| 스크린샷 수집 | `scripts/capture-window.ps1 -ProcessId <pid> -Out <png>` |
| 메모리 비교 (Orca) | `scripts/measure-memory.ps1` |
| 테스트용 설정 폴더 | 환경 변수 `VA_DATA_DIR` (지정하면 개인 설정 대신 그 폴더를 쓴다) |
| 테스트용 휴지통 | 환경 변수 `VA_TRASH_DIR` (지정하면 지운 것을 Windows 휴지통 대신 그 폴더로 옮긴다) |
| 설치된 셸 숨기기 | 환경 변수 `VA_HIDE_SHELLS` (쉼표로 적은 셸을 없는 것으로 친다. 이름은 `pwsh`, `cmd`. `pwsh`만 적으면 명령 프롬프트로 뜬다) |
| 시험용 에이전트 | `build\core\va_fake_agent.exe [기록 파일]` (화면 전체를 쓰고 받은 키를 적는다. `claude.exe`로 이름을 바꿔 실행하면 Claude Code로 표시된다) |
| 메모리 비교, 터미널 3개 (Orca) | `cd ui && node e2e/measure-terminals.mjs 3 30` (Orca에서도 터미널 3개를 띄워 둔 상태로 잰다) |
| 실제 Windows 휴지통 확인 | `build\core\va_tests.exe -tc="recycle-bin-real*" --no-skip` (돌릴 때마다 휴지통에 `va-recycle-…` 항목이 남는다) |
| 코어 파일 규칙 검사만 | `node scripts/lint-core-files.mjs` |
| SNS 계정·토큰 | `private/` (자격 증명 기재 금지, 저장소 커밋 금지) |

## 모듈 경계
도메인 프로필의 권장 경계 중 실제 적용한 항목. 강제 수단 미구현 시 "예정".

| 경계 규칙 | 강제 수단 | 상태 |
|---|---|---|
| `ui/src/ui`는 `data`, `features`를 참조하지 않음 | ESLint `no-restricted-imports` | 적용 |
| `ui/src/domain`은 `ui`, `data`, `features`, `app`, React를 참조하지 않음 | ESLint `no-restricted-imports` | 적용 |
| 코어 요청(`fetch`)과 코어 주소(`/api/…`)는 `ui/src/data`에만 둠 | ESLint `no-restricted-syntax` | 적용 |
| `useEffect`, `setTimeout`, `any`, 우회 정당화 주석 금지 | ESLint | 적용 |
| 색은 `design/theme-kirin.css`의 토큰만 사용 (화면과 창 쪽 코드 모두) | `ui/scripts/lint-colors.mjs` | 적용 |
| `core/src/domain`은 파일 시스템·창·네트워크를 참조하지 않음 | 없음 | 예정 |
| `core/src`는 사용자 파일을 덮어쓰거나 휴지통을 거치지 않고 지우는 함수를 쓰지 않음 (`std::filesystem::rename`·`remove`, `MOVEFILE_REPLACE_EXISTING`, `DeleteFile` 등) | `scripts/lint-core-files.mjs` | 적용 |

## 패스트트랙
명세 없이 구현 가능한 조건 (전부 충족 필요):
- 변경 범위가 작고 되돌리기 쉬움
- 가정 사항 발생 여지 없음 (오타, 문구, 명확한 단일 수정)
- 결제, 개인정보, 권한, 상태 전이, 영속 데이터와 무관
- DB 스키마·데이터 마이그레이션 아님

**항상 정식 절차**를 적용하는 영역:
- SNS 게시, 댓글 답변, 좋아요 등 외부 계정에 반영되는 모든 동작
- 자격 증명(토큰, 접속 코드) 처리
- 아이폰 등 다른 기기에서의 접속 경로
- 개인 설정 파일(`state.json`)의 형식 변경
- 사용자 파일을 옮기거나 지우거나 덮어쓸 수 있는 코드 (`core/src/data/project_files.cpp`, `recycle_bin.cpp`)
- 프로그램을 실행하거나 끝내는 코드 (`core/src/data/pty.cpp`, `terminals.cpp`)
