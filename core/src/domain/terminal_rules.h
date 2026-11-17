// 터미널의 규칙: 어떤 셸을 띄울지, 터미널 줄의 이름, 실행 중인 에이전트 알아보기.
// 파일 시스템, 프로세스, 창을 모른다.
#pragma once

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

}  // namespace va::domain
