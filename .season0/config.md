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

화면 타입 검사 → 화면 린트 → 색상표 검사 → 화면 테스트 → 화면 빌드 → 코어 빌드 → 코어 테스트 → 실행 파일 묶기 → 앱 창 테스트 순으로 돌고, 하나라도 실패하면 멈춘다. 마지막 단계에서 실제 앱 창이 20초쯤 떴다가 닫힌다.

베이스라인 파일: 없음

필요한 도구: Visual Studio Build Tools 2022(C++, CMake 도구 포함), vcpkg(`%USERPROFILE%\vcpkg` 또는 `VCPKG_ROOT`), Node.js. 처음 한 번 `ui/`에서 `npm install`.

## 실행·증적 수집 명령

| 용도 | 명령 |
|---|---|
| 앱만 빌드 | `npm run build` → `build/dist/Visual-Agent/` |
| 앱 실행 | `npm start` 또는 `build\dist\Visual-Agent\Visual-Agent.exe` |
| 앱 창 테스트 | `cd ui && npm run e2e` |
| 앱 창 테스트 + 스크린샷 | `VA_EVIDENCE_DIR=<폴더>`를 정하고 `npm run e2e` |
| 실제 마우스로 창 다루기 테스트 | `cd ui && npm run e2e:mouse` (커서가 몇 초 움직인다) |
| 스크린샷 수집 | `scripts/capture-window.ps1 -ProcessId <pid> -Out <png>` |
| 메모리 비교 (Orca) | `scripts/measure-memory.ps1` |
| 테스트용 설정 폴더 | 환경 변수 `VA_DATA_DIR` (지정하면 개인 설정 대신 그 폴더를 쓴다) |
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
