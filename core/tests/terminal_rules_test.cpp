#include <doctest/doctest.h>

#include "domain/terminal_rules.h"

using namespace va::domain;

TEST_CASE("띄우는 셸은 PowerShell 7과 명령 프롬프트 둘뿐이고, PowerShell 7이 먼저다 (AC3)") {
    const auto& shells = knownShells();
    REQUIRE(shells.size() == 2);
    CHECK(shells[0].id == "pwsh");
    CHECK(shells[0].label == "PowerShell");
    CHECK(shells[1].id == "cmd");
    CHECK(shells[1].label == "cmd");
}

TEST_CASE("터미널 줄의 이름은 셸 이름과 번호이고, 번호는 비어 있는 가장 작은 수다 (AC14)") {
    CHECK(terminalName("PowerShell", 1) == "PowerShell 1");
    CHECK(nextTerminalNumber({}) == 1);
    CHECK(nextTerminalNumber({1, 2}) == 3);
    CHECK(nextTerminalNumber({1, 3}) == 2);
    CHECK(nextTerminalNumber({2}) == 1);
}

TEST_CASE("실행 중인 프로그램 가운데 Claude Code와 Codex를 알아본다 (AC21)") {
    CHECK(detectAgent({{1, L"pwsh.exe", L""}}) == "");
    CHECK(detectAgent({{1, L"pwsh.exe", L""}, {2, L"claude.exe", L""}}) == "Claude Code");
    CHECK(detectAgent({{1, L"cmd.exe", L""}, {2, L"Claude.EXE", L""}}) == "Claude Code");
    CHECK(detectAgent({{2, L"node.exe",
                        L"node C:\\Users\\a\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"}}) ==
          "Claude Code");
    CHECK(detectAgent({{2, L"node.exe", L"\"node.exe\" C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js"}}) ==
          "Codex");
    CHECK(detectAgent({{2, L"codex-x86_64-pc-windows-msvc.exe", L""}}) == "Codex");
    CHECK(detectAgent({{2, L"codex.exe", L""}}) == "Codex");
}

TEST_CASE("에이전트가 아닌 프로그램은 에이전트로 보지 않는다") {
    CHECK(detectAgent({{2, L"node.exe", L"node server.js"}}) == "");
    CHECK(detectAgent({{2, L"git.exe", L""}, {3, L"notclaude.exe", L""}}) == "");
    // node가 아닌 프로그램의 명령줄에 이름이 들어 있는 것만으로는 에이전트가 아니다
    CHECK(detectAgent({{2, L"notepad.exe", L"notepad claude-code.txt"}}) == "");
    CHECK(needsCommandLine(L"Node.exe"));
    CHECK_FALSE(needsCommandLine(L"claude.exe"));
}

TEST_CASE("셸만 떠 있으면 실행 중인 프로그램이 없는 것으로 본다 (AC17)") {
    CHECK_FALSE(hasRunningProgram({{10, L"pwsh.exe", L""}}, 10));
    CHECK_FALSE(hasRunningProgram({{10, L"cmd.exe", L""}, {11, L"conhost.exe", L""}}, 10));
    CHECK_FALSE(hasRunningProgram({}, 10));
}

TEST_CASE("셸 안에서 다른 프로그램이 돌고 있으면 실행 중인 프로그램이 있는 것으로 본다 (AC17)") {
    CHECK(hasRunningProgram({{10, L"pwsh.exe", L""}, {11, L"claude.exe", L""}}, 10));
    CHECK(hasRunningProgram({{10, L"cmd.exe", L""}, {11, L"PING.EXE", L""}}, 10));
    // 셸 안에서 띄운 또 다른 셸도 실행 중인 프로그램이다
    CHECK(hasRunningProgram({{10, L"pwsh.exe", L""}, {11, L"cmd.exe", L""}}, 10));
}

TEST_CASE("에이전트 상태: 출력이 이어지면 작업 중, 2.5초 조용하면 입력 대기 (AC2, AC3)") {
    using namespace va::domain;
    using namespace std::chrono_literals;
    const Clock::time_point t0 = Clock::time_point{} + 1000s;

    AgentActivity state;
    // 에이전트가 없으면 상태도 없다
    state = advanceActivity(state, false, t0, t0 + 2s, t0 + 2s);
    CHECK_FALSE(state.working);
    // 출력이 없었으면 입력 대기
    state = advanceActivity(state, true, std::nullopt, std::nullopt, t0);
    CHECK_FALSE(state.working);
    // 출력이 0.7초 넘게 이어지면 작업 중. 시작한 때는 출력이 시작된 때다
    state = advanceActivity(state, true, t0 + 1s, t0 + 1s + 600ms, t0 + 1s + 600ms);
    CHECK_FALSE(state.working);
    state = advanceActivity(state, true, t0 + 1s, t0 + 1s + 700ms, t0 + 1s + 800ms);
    CHECK(state.working);
    CHECK(state.startedAt == t0 + 1s);
    // 출력이 이어지는 동안 계속 작업 중
    state = advanceActivity(state, true, t0 + 1s, t0 + 5s, t0 + 5s + 2400ms);
    CHECK(state.working);
    CHECK(state.finished == 0);
    // 2.5초 조용하면 입력 대기. 4초 이어진 작업이었으므로 마친 작업으로 센다
    state = advanceActivity(state, true, t0 + 1s, t0 + 5s, t0 + 5s + 2500ms);
    CHECK_FALSE(state.working);
    CHECK(state.finished == 1);
    // 그대로 조용하면 더 세지 않는다
    state = advanceActivity(state, true, t0 + 1s, t0 + 5s, t0 + 60s);
    CHECK(state.finished == 1);
}

TEST_CASE("에이전트 상태: 쉬는 중에 화면을 한 번 고쳐 그리는 것은 작업이 아니다 (AC4)") {
    using namespace va::domain;
    using namespace std::chrono_literals;
    const Clock::time_point t0 = Clock::time_point{} + 1000s;

    AgentActivity state;
    for (const auto now : {t0, t0 + 100ms, t0 + 1s, t0 + 2s, t0 + 3s}) {
        state = advanceActivity(state, true, t0, t0, now);
        CHECK_FALSE(state.working);
    }
    state = advanceActivity(state, true, t0, t0 + 300ms, t0 + 400ms);
    CHECK_FALSE(state.working);
    CHECK(state.finished == 0);

    // 앞의 출력에 2.5초 안에 이어진 출력은 같은 흐름이고, 그보다 늦으면 새로 시작된 것이다
    CHECK_FALSE(continuesBurst(std::nullopt, t0));
    CHECK(continuesBurst(t0, t0 + 2400ms));
    CHECK_FALSE(continuesBurst(t0, t0 + 2500ms));
}

TEST_CASE("에이전트 상태: 3초보다 짧은 화면 갱신은 마친 작업으로 세지 않고, 에이전트가 끝나면 처음으로 돌아간다 (AC5, AC8)") {
    using namespace va::domain;
    using namespace std::chrono_literals;
    const Clock::time_point t0 = Clock::time_point{} + 1000s;

    AgentActivity state;
    state = advanceActivity(state, true, t0, t0 + 1s, t0 + 1s);
    CHECK(state.working);
    state = advanceActivity(state, true, t0, t0 + 2900ms, t0 + 6s);
    CHECK_FALSE(state.working);
    CHECK(state.finished == 0);

    state = advanceActivity(state, true, t0 + 10s, t0 + 11s, t0 + 11s);
    CHECK(state.working);
    state = advanceActivity(state, true, t0 + 10s, t0 + 13s, t0 + 16s);
    CHECK(state.finished == 1);

    state = advanceActivity(state, false, t0 + 10s, t0 + 13s, t0 + 17s);
    CHECK_FALSE(state.working);
    CHECK(state.finished == 0);
}

TEST_CASE("에이전트 상태: 입력 뒤 0.4초 안의 출력은 넣은 글자가 되비친 것으로 본다 (AC4)") {
    using namespace va::domain;
    using namespace std::chrono_literals;
    const Clock::time_point t0 = Clock::time_point{} + 1000s;
    CHECK_FALSE(isEchoOutput(std::nullopt, t0));
    CHECK(isEchoOutput(t0, t0));
    CHECK(isEchoOutput(t0, t0 + 399ms));
    CHECK_FALSE(isEchoOutput(t0, t0 + 400ms));
    CHECK_FALSE(isEchoOutput(t0 + 1s, t0));
}
