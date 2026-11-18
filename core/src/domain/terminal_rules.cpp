#include "domain/terminal_rules.h"

#include <algorithm>
#include <cwctype>

namespace va::domain {

namespace {

std::wstring lower(std::wstring text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
    return text;
}

bool contains(const std::wstring& text, const wchar_t* part) {
    return text.find(part) != std::wstring::npos;
}

bool startsWith(const std::wstring& text, const wchar_t* prefix) {
    return text.rfind(prefix, 0) == 0;
}

// 셸이 명령을 기다리는 동안에도 함께 떠 있는 보조 프로그램
bool isShellHelper(const std::wstring& image) {
    return image == L"conhost.exe" || image == L"openconsole.exe";
}

}  // namespace

const std::vector<ShellKind>& knownShells() {
    static const std::vector<ShellKind> shells = {
        {"pwsh", "PowerShell"},
        {"cmd", "cmd"},
    };
    return shells;
}

unsigned nextTerminalNumber(const std::vector<unsigned>& used) {
    for (unsigned number = 1;; ++number) {
        if (std::find(used.begin(), used.end(), number) == used.end()) return number;
    }
}

std::string terminalName(const std::string& shellLabel, unsigned number) {
    return shellLabel + " " + std::to_string(number);
}

bool needsCommandLine(const std::wstring& image) { return lower(image) == L"node.exe"; }

std::string detectAgent(const std::vector<ProcessInfo>& processes) {
    for (const auto& process : processes) {
        const std::wstring image = lower(process.image);
        const std::wstring command = lower(process.commandLine);
        const bool node = image == L"node.exe";

        if (image == L"claude.exe" || (node && contains(command, L"claude-code"))) return "Claude Code";
        if (startsWith(image, L"codex") ||
            (node && (contains(command, L"@openai\\codex") || contains(command, L"@openai/codex")))) {
            return "Codex";
        }
    }
    return {};
}

bool hasRunningProgram(const std::vector<ProcessInfo>& processes, unsigned long shellPid) {
    return std::any_of(processes.begin(), processes.end(), [&](const ProcessInfo& process) {
        return process.pid != shellPid && !isShellHelper(lower(process.image));
    });
}

}  // namespace va::domain

namespace va::domain {

bool isEchoOutput(std::optional<Clock::time_point> lastInput, Clock::time_point outputAt) {
    return lastInput && outputAt >= *lastInput && outputAt - *lastInput < kEchoWindow;
}

bool continuesBurst(std::optional<Clock::time_point> lastActivity, Clock::time_point outputAt) {
    return lastActivity && outputAt - *lastActivity < kQuietMeansWaiting;
}

AgentActivity advanceActivity(AgentActivity current, bool agentRunning,
                              std::optional<Clock::time_point> burstStart,
                              std::optional<Clock::time_point> lastActivity, Clock::time_point now,
                              bool reported) {
    // 에이전트가 끝나면 상태도 없다. 다시 실행하면 처음부터 센다
    if (!agentRunning) return {};

    const bool recent = burstStart && lastActivity && now - *lastActivity < kQuietMeansWaiting;
    const bool drawing = recent && *lastActivity - *burstStart >= kSustainedOutput;
    const bool active = drawing || reported;
    if (active && !current.working) {
        current.working = true;
        current.startedAt = drawing ? *burstStart : now;
    } else if (!active && current.working) {
        current.working = false;
        // 스스로 알려 준 작업은 알려 준 지금 끝난 것이고, 출력으로 짐작한 작업은 마지막 출력 때 끝난 것이다
        const std::optional<Clock::time_point> endedAt =
            current.reported ? std::optional<Clock::time_point>(now) : lastActivity;
        if (endedAt && *endedAt - current.startedAt >= kShortestRun) ++current.finished;
    }
    current.reported = current.working && reported;
    return current;
}

}  // namespace va::domain
