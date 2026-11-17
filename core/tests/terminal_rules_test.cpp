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
