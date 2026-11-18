# ADR-006: 하위 에이전트와 정확한 상태는 Claude Code의 훅으로 받고, 훅은 터미널에만 알려 준 값으로 코어에 알린다

- 상태: 채택
- 날짜: 2026-11-18
- 관련 명세: SPEC-20261118-sub-agents

## Context
Claude Code가 부리는 하위 에이전트는 Claude Code 프로그램 안에서 돈다. 터미널 밖에서는 프로그램 하나만 보이므로, 프로세스나 출력을 봐서는 알 수 없다. 또 에이전트 상태를 출력으로 짐작하는 방식(ADR-004)은 화면이 조용한 채 생각하는 구간을 "입력 대기"로 잘못 보고, 허락을 기다리는 것과 다음 질문을 기다리는 것을 구별하지 못한다. Claude Code는 정해진 때에 사용자가 정한 명령을 실행해 주는 훅을 제공한다.

## Decision
- **Claude Code의 훅으로 받는다.** 훅은 사용자의 Claude Code 설정(`~/.claude/settings.json`)에 9가지 때에 건다: SessionStart, SessionEnd, UserPromptSubmit, Stop, StopFailure, PermissionRequest, SubagentStart, SubagentStop, 그리고 하위 에이전트를 부리는 도구(Agent, 예전 이름 Task)에 한정한 PreToolUse. 모든 도구 사용에는 걸지 않는다 (Claude Code를 느리게 하지 않으려고).
- **훅이 실행하는 것은 작은 프로그램 `va-hook.exe`다** (`core/src/hook/main.cpp`). 훅이 표준 입력으로 넘겨준 JSON을 그대로 코어에 보낸다 (`POST /api/hooks/claude`). 해석은 코어가 한다. 그래서 Claude Code가 넘겨주는 내용이 달라져도 이 프로그램은 바꿀 필요가 없다. 어떤 경우에도 아무것도 출력하지 않고 0으로 끝난다 (출력은 대화에 섞이고, 실패는 Claude Code에 오류로 보이기 때문).
- **어느 터미널의 소식인지는 환경 변수로 안다.** 코어는 터미널을 띄울 때 그 셸에 `VA_HOOK_PORT`, `VA_HOOK_TOKEN`, `VA_TERMINAL_ID`를 넘긴다. 셸에서 실행한 Claude Code와 그 훅이 이를 물려받는다. 이 값이 없으면(Visual-Agent 밖에서 실행한 Claude Code) `va-hook.exe`는 바로 끝난다.
- **훅의 값은 화면의 값과 다르다.** `VA_HOOK_TOKEN`은 앱이 켜질 때마다 새로 만들고, `/api/hooks/claude`에만 통한다. 터미널 안의 프로그램은 이 값으로 파일이나 터미널 요청을 할 수 없다. 화면의 값(`X-VA-Token`)은 터미널에 알려 주지 않는다.
- **훅 소식의 규칙은 순수한 함수다** (`core/src/domain/agent_hooks.cpp`의 `applyHookEvent`, `noteUserInput`). 터미널마다 "답하는 중", "허락을 묻는 중", "돌고 있는 하위 에이전트"를 들고 있다.
  - 하위 에이전트의 설명은 "부리기 직전"(PreToolUse) 소식의 설명을, 뒤이어 온 "시작"(SubagentStart) 소식 가운데 종류가 같은 가장 앞의 것과 짝짓는다. "시작" 소식에는 설명이 없기 때문이다.
  - "답을 마침"(Stop)에는 뒤에서 아직 도는 하위 에이전트의 목록(`background_tasks`)이 온다. 그 목록에 없는 하위 에이전트는 치운다 (끝났다는 소식을 놓친 것의 뒷정리).
  - 사용자가 멈추게 하면 Stop이 오지 않는다. 그래서 답하는 중에 터미널에 Esc 하나나 Ctrl+C가 들어가면 멈춘 것으로 본다.
  - 허락 대기는 터미널에 글자나 Enter가 들어가면 풀린 것으로 본다. ESC로 시작하는 입력(화살표 키, 터미널이 스스로 보내는 "창을 보고 있음/있지 않음")은 답이 아니다.
- **출력으로 짐작하는 방식(ADR-004)은 남긴다.** 훅이 "작업 중"이라고 하면 화면이 조용해도 작업 중이고(`advanceActivity`의 `reported`), 훅이 아무 말도 하지 않을 때는 전처럼 출력으로 짐작한다. 훅을 넣지 않은 PC, 훅이 없는 에이전트(Codex), 훅 소식 없이 시작되는 작업이 그대로 동작한다.
- **훅은 앱이 스스로 넣지 않는다.** `node scripts/claude-hooks.mjs install`이 `va-hook.exe`를 `%LOCALAPPDATA%\Visual-Agent\hooks`에 복사하고 설정에 넣는다. 다른 프로그램의 훅은 건드리지 않고, 처음 고치기 전의 파일을 `settings.json.before-visual-agent`로 남긴다. `remove`로 뺀다.

## Alternatives Considered
- 터미널 출력(화면의 글자)을 읽어 하위 에이전트를 알아내기: Claude Code의 화면 모양에 기대게 되고 판이 바뀌면 깨진다.
- Claude Code가 쓰는 대화 기록 파일을 지켜보기: 파일 형식이 공개된 약속이 아니고, 늦게 쓰인다.
- 훅을 HTTP 방식으로 직접 코어에 보내기: 주소(포트)가 앱을 켤 때마다 달라지고, Visual-Agent 밖에서 실행한 Claude Code에서는 매번 실패한 요청이 된다.
- 모든 도구 사용에 훅을 걸기: 지금 쓰는 도구까지 보여 줄 수 있지만, 도구를 쓸 때마다 프로그램이 한 번씩 실행된다.
- 앱이 켜질 때 스스로 훅을 넣기: 사용자가 모르는 사이에 다른 프로그램의 설정을 고치게 된다.

## Consequences
- 이 PC의 모든 Claude Code가 9가지 때마다 `va-hook.exe`를 한 번씩 실행한다. Visual-Agent 밖에서는 환경 변수가 없어 바로 끝난다.
- 같은 종류의 하위 에이전트를 동시에 여러 명 부리면 설명이 서로 바뀌어 붙을 수 있다.
- 하위 에이전트가 또 부린 하위 에이전트는 같은 단에 보인다 (누가 부렸는지 훅이 알려 주지 않는다).
- 터미널 안에서 실행한 다른 프로그램도 환경 변수를 읽어 거짓 훅 소식을 보낼 수 있다. 할 수 있는 일은 그 터미널 줄의 표시를 바꾸는 것뿐이다.
- 훅 프로그램을 고치면 `install`을 다시 실행해야 복사본이 바뀐다.
