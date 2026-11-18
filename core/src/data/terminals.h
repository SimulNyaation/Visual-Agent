// 떠 있는 터미널들을 관리한다: 띄우기, 닫기, 글자 주고받기, 실행 중인 에이전트 알아보기.
#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <filesystem>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "data/pty.h"
#include "domain/agent_hooks.h"
#include "domain/terminal_rules.h"
#include "data/shell_finder.h"

namespace va::data {

// 화면에 보내는 터미널 하나의 모습
struct TerminalView {
    std::string id;
    std::string tabId;
    std::string shell;  // 셸의 내부 이름
    std::string name;   // 예: "PowerShell 1"
    std::string agent;  // 실행 중인 에이전트 이름. 없으면 빈 문자열
    bool busy = false;  // 셸 안에서 무언가 돌고 있음
    bool working = false;   // 에이전트가 작업 중 (아니면 입력을 기다린다). 에이전트가 없으면 false
    unsigned finished = 0;  // 에이전트가 실행된 뒤 마친 작업 수
    bool asking = false;    // 에이전트가 허락을 묻고 기다리는 중 (훅으로 알려 준 때에만 안다)
    std::vector<domain::SubAgent> subAgents;  // 에이전트가 지금 부리고 있는 하위 에이전트 (훅으로 알려 준 때에만 안다)
};

struct TerminalOutput {
    std::string id;
    std::string bytes;
};

struct TerminalEvents {
    std::uint64_t version = 0;            // 터미널 목록이 바뀔 때마다 커진다
    std::vector<TerminalView> terminals;
    std::vector<TerminalOutput> output;   // 지난번 이후 나온 글자. 한 번 받아 가면 다시 주지 않는다
    bool superseded = false;              // 더 새로운 기다림이 들어와 이 기다림은 빈손으로 끝남
};

class Terminals {
public:
    explicit Terminals(std::vector<InstalledShell> shells);
    ~Terminals();

    Terminals(const Terminals&) = delete;
    Terminals& operator=(const Terminals&) = delete;

    const std::vector<InstalledShell>& shells() const { return shells_; }

    // 이 뒤에 띄우는 터미널에, 그 안의 에이전트가 훅으로 소식을 보낼 곳을 환경 변수로 알려 준다
    void setHookEndpoint(int port, std::string token);
    // 터미널 안의 에이전트가 훅으로 알려 준 소식. 그런 터미널이 없으면 false
    bool noteHook(const std::string& id, const domain::HookEvent& event);

    // 탭의 폴더에서 셸을 띄운다. 앞의 셸부터 차례로 띄워 보고, 처음 뜬 것을 쓴다. 하나도 뜨지 않으면 빈 값
    std::optional<TerminalView> open(const std::string& tabId, const std::filesystem::path& directory);
    bool write(const std::string& id, std::string_view bytes);
    bool resize(const std::string& id, int columns, int rows);
    // 터미널을 닫는다. 그 안에서 돌던 것은 끝난다. 목록에서는 뒷정리가 끝난 뒤 사라진다
    bool close(const std::string& id);
    void closeTab(const std::string& tabId);

    bool exists(const std::string& id);
    // 지금 이 순간을 기준으로 다시 알아본다
    bool busy(const std::string& id);
    bool tabBusy(const std::string& tabId);
    bool anyBusy();

    std::vector<TerminalView> list();
    // 그 터미널의 셸과 셸에서 실행된 프로그램들의 번호
    std::vector<unsigned long> processIds(const std::string& id);

    // 새 출력이 있거나 목록이 knownVersion과 달라질 때까지 기다린다.
    // 기다리는 쪽은 한 번에 하나뿐이다. 새 기다림이 들어오면 앞의 것은 빈손으로 끝난다
    TerminalEvents wait(std::uint64_t knownVersion, std::chrono::milliseconds timeout);
    // 기다리는 쪽을 깨워 목록을 다시 받아 가게 한다
    void touch();

    // 모든 터미널을 닫고 뒷정리가 끝날 때까지 기다린다
    void shutdown();

private:
    struct Entry {
        std::string id;
        std::string tabId;
        std::string shellId;
        std::string name;
        unsigned number = 0;
        std::unique_ptr<Pty> pty;
        std::thread reader;
        std::string agent;
        bool busy = false;
        domain::AgentActivity activity;
        domain::HookState hook;  // 에이전트가 훅으로 알려 준 상태
        std::optional<std::chrono::steady_clock::time_point> lastInput;     // 입력이나 크기 변경을 받은 때
        std::optional<std::chrono::steady_clock::time_point> lastActivity;  // 작업으로 친 마지막 출력의 때
        std::optional<std::chrono::steady_clock::time_point> burstStart;    // 그 출력이 이어지기 시작한 때
        bool closing = false;
        std::chrono::steady_clock::time_point closeAt;  // 닫기 시작한 때
        std::atomic<bool> finished{false};
    };

    void readLoop(const std::shared_ptr<Entry>& entry);
    void noteInput(const std::shared_ptr<Entry>& entry);
    // 상태를 지금 기준으로 다시 정한다. 화면에 보내는 것이 달라졌으면 true
    static bool refreshLocked(Entry& entry);
    static TerminalView viewOf(const Entry& entry);
    void monitorLoop();
    std::shared_ptr<Entry> find(const std::string& id);
    std::vector<std::shared_ptr<Entry>> entriesOfTab(const std::string& tabId);
    std::vector<TerminalView> viewsLocked() const;
    static bool busyNow(const Entry& entry);

    const std::vector<InstalledShell> shells_;

    std::mutex mutex_;
    std::condition_variable changed_;
    std::vector<std::shared_ptr<Entry>> entries_;
    std::vector<std::shared_ptr<Entry>> finished_;  // 읽기가 끝나 정리를 기다리는 것
    std::deque<TerminalOutput> queue_;
    std::size_t queuedBytes_ = 0;
    std::uint64_t version_ = 1;
    std::uint64_t waitGeneration_ = 0;
    unsigned nextId_ = 1;
    int hookPort_ = 0;
    std::string hookToken_;
    bool stopping_ = false;
    std::thread monitor_;
};

}  // namespace va::data
