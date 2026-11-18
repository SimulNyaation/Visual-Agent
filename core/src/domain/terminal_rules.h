// 터미널의 규칙: 어떤 셸을 띄울지, 터미널 줄의 이름, 실행 중인 에이전트 알아보기.
// 파일 시스템, 프로세스, 창을 모른다.
#pragma once

#include <chrono>
#include <optional>
#include <string>
#include <vector>

namespace va::domain {

struct ShellKind {
    std::string id;     // 내부 이름
    std::string label;  // 터미널 줄에 번호와 함께 표시할 이름
};

// 앱이 띄우는 셸. 앞의 것(PowerShell 7)을 먼저 띄워 보고, 없거나 뜨지 않으면 다음 것(명령 프롬프트)을 띄운다
const std::vector<ShellKind>& knownShells();

// 쓰이지 않는 가장 작은 번호 (1부터)
unsigned nextTerminalNumber(const std::vector<unsigned>& used);

// 예: "PowerShell 1"
std::string terminalName(const std::string& shellLabel, unsigned number);

// 터미널에서 돌고 있는 프로그램 하나
struct ProcessInfo {
    unsigned long pid = 0;
    std::wstring image;        // 실행 파일 이름 (폴더 제외)
    std::wstring commandLine;  // 필요할 때만 채운다
};

// 실행 파일 이름만으로는 에이전트인지 알 수 없어 명령줄까지 봐야 하는 프로그램인가 (node로 실행되는 에이전트)
bool needsCommandLine(const std::wstring& image);

// 돌고 있는 프로그램 가운데 에이전트가 있으면 그 이름("Claude Code", "Codex"), 없으면 빈 문자열
std::string detectAgent(const std::vector<ProcessInfo>& processes);

// 셸이 명령을 기다리기만 하는 것이 아니라 그 안에서 무언가 돌고 있는가.
// 셸 자신과 셸이 늘 함께 띄우는 보조 프로그램은 세지 않는다
bool hasRunningProgram(const std::vector<ProcessInfo>& processes, unsigned long shellPid);

// ── 에이전트 상태: 작업 중인지, 입력을 기다리는지 ──
// 에이전트는 작업하는 동안 화면에 계속 무언가를 그린다(답, 진행 표시). 그래서 "출력이 이어지면 작업 중,
// 한동안 조용하면 입력 대기"로 본다. 사용자가 넣은 글자가 화면에 되비치는 출력은 작업으로 치지 않는다.
using Clock = std::chrono::steady_clock;

// 이만큼 출력이 없으면 입력을 기다리는 것으로 본다
constexpr std::chrono::milliseconds kQuietMeansWaiting{2500};
// 사용자의 입력이나 크기 변경 뒤 이 시간 안에 나온 출력은 그에 대한 화면 갱신으로 본다
constexpr std::chrono::milliseconds kEchoWindow{400};
// 출력이 이만큼 이어져야 작업으로 본다. 쉬는 중에 화면을 한 번 고쳐 그리는 것은 작업이 아니다
constexpr std::chrono::milliseconds kSustainedOutput{700};
// 이보다 길게 이어진 작업이 끝나야 "작업 하나를 마쳤다"고 센다 (시작 화면, 짧은 화면 갱신은 세지 않는다)
constexpr std::chrono::milliseconds kShortestRun{3000};

struct AgentActivity {
    bool working = false;        // 작업 중
    unsigned finished = 0;       // 에이전트가 실행된 뒤 마친 작업 수
    Clock::time_point startedAt; // 지금 작업이 시작된 때 (working일 때만 뜻이 있다)
};

// 출력이 사용자의 입력에 대한 화면 갱신인지
bool isEchoOutput(std::optional<Clock::time_point> lastInput, Clock::time_point outputAt);

// 지금 상태를 다시 정한다. lastActivity는 작업으로 친 마지막 출력의 때,
// burstStart는 그 출력이 속한 "끊기지 않고 이어진 출력"이 시작된 때
AgentActivity advanceActivity(AgentActivity current, bool agentRunning,
                              std::optional<Clock::time_point> burstStart,
                              std::optional<Clock::time_point> lastActivity, Clock::time_point now);

// 새 출력이 앞의 출력에 이어진 것인지 (아니면 새로 시작된 출력이다)
bool continuesBurst(std::optional<Clock::time_point> lastActivity, Clock::time_point outputAt);

}  // namespace va::domain
