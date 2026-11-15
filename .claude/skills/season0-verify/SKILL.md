---
name: season0-verify
description: 구현이 완료된 Season0 명세(status verifying)에 대해 인수 기준별 증적을 수집하고 검증 보고서를 작성한다. 애플리케이션을 직접 실행해 스크린샷, 테스트 결과, 로그, 지표 그래프를 확보한다. 구현 완료 직후 또는 /season0-verify 입력 시 사용.
---

# 검증

`private/specs/<ID>/verification.md`와 `private/specs/<ID>/evidence/`를 생성한다. 증적 인정 기준은 `.season0/core/verification.md`를 따른다.

## 절차

1. **인수 기준(AC)별 검증**
   - `config.md`의 실행·증적 수집 명령으로 애플리케이션을 실제 실행한다
   - 기준별로 가장 높은 등급의 증적을 확보한다: 자동 검사 결과 > 재현 가능한 실행 기록 > 실행 화면 > 로그·지표 > 다이어그램
   - `.season0/domains/` 도메인 프로필의 "권장 증적 형태"를 참조한다 (예: social은 다중 계정 비교, simulation은 동일 시드 전후 비교)
   - 증적 파일명은 기준 ID 기반으로 한다: `evidence/AC1-before.png`, `evidence/AC1-after.png`

2. **판정**
   - ✅ 증적이 있는 경우에만
   - ❌ 검증 결과 미충족
   - ⚪ 미검증. 사유와 **Human 직접 확인 절차** 필수
   - 증적 없이 ✅ 판정하지 않는다. "정상 동작할 것입니다"는 증적이 아니다

3. **보고서 작성**
   - 변경 요약: 코드 용어가 아닌 Plain Language, 기능 맵 명칭 기준
   - 근본 원인 분석과 변경 전 실패 증적 (bugfix인 경우)
   - 추가된 결정적 검사와 오류 메시지
   - 품질 게이트 결과
   - 범위 외 발견 사항
   - 범위 제외(OOS) 준수 여부

4. **교정 로그 갱신**
   - 이번 작업 중 Human이 교정을 지시했다면 `.season0/correction-log.md`에 기록하거나 횟수를 갱신한다
   - 2회 이상 누적 항목은 `/season0-enforce` 대상임을 알린다

5. **보고**
   - ❌, ⚪ 항목을 **우선** 보고한다
   - 검증 보고서 경로를 제시하고 판정을 요청한다
   - `status`는 `verifying`으로 유지한다. **`done` 전이는 Human 전용이다**

## ❌ 발생 시

Human에게 보고하고, 재작업 지시를 받으면 `status: in-progress`로 되돌려 `/season0-implement` 규칙으로 수정한다. 인수 기준 자체가 잘못된 경우 명세를 수정해 재승인을 받는다.
