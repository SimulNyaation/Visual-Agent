// 실제 셸(명령 프롬프트)을 띄워 터미널 관리 부분을 확인한다.
#include <doctest/doctest.h>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <thread>

#include <windows.h>

#include "data/shell_finder.h"
#include "data/terminals.h"
#include "domain/project_tabs.h"
#include "temp_dir.h"

using namespace std::chrono_literals;
using va::data::Terminals;
using Path = std::filesystem::path;
namespace fs = std::filesystem;

namespace {

struct TerminalsFixture {
    va::test::TempDir dir;
    Terminals terminals{va::data::findShells({"pwsh"})};
    std::string seen;          // 지금까지 받은 출력 (터미널 구분 없이)
    std::uint64_t version = 0;
    std::vector<va::data::TerminalView> list;

    void pump(std::chrono::milliseconds timeout = 200ms) {
        const auto events = terminals.wait(version, timeout);
        version = events.version;
        list = events.terminals;
        for (const auto& chunk : events.output) seen += chunk.bytes;
    }

    template <typename Check>
    bool until(Check check, std::chrono::seconds limit = 15s) {
        const auto deadline = std::chrono::steady_clock::now() + limit;
        while (std::chrono::steady_clock::now() < deadline) {
            if (check()) return true;
            pump();
        }
        return check();
    }

    bool untilSeen(const std::string& text, std::chrono::seconds limit = 15s) {
        return until([&] { return seen.find(text) != std::string::npos; }, limit);
    }

    std::string openCmd(const std::string& tab = "t1") {
        const auto view = terminals.open(tab, dir.path());
        REQUIRE(view);
        // 셸이 명령을 받을 준비가 될 때까지 기다린다
        REQUIRE(untilSeen(">"));
        return view->id;
    }

    const va::data::TerminalView* find(const std::string& id) const {
        for (const auto& view : list) {
            if (view.id == id) return &view;
        }
        return nullptr;
    }
};

bool running(unsigned long pid) {
    const HANDLE process = OpenProcess(SYNCHRONIZE, FALSE, pid);
    if (process == nullptr) return false;
    const bool alive = WaitForSingleObject(process, 0) == WAIT_TIMEOUT;
    CloseHandle(process);
    return alive;
}

std::string readFile(const Path& path) {
    std::ifstream file(path, std::ios::binary);
    std::stringstream content;
    content << file.rdbuf();
    return content.str();
}

}  // namespace

TEST_CASE("터미널은 탭의 폴더에서 시작하고, 입력한 명령의 결과가 돌아온다 (AC1, AC5)") {
    TerminalsFixture f;
    const auto id = f.openCmd();

    REQUIRE(f.terminals.write(id, "echo here=%CD%\r"));
    CHECK(f.untilSeen("here=" + va::domain::toUtf8(fs::canonical(f.dir.path()))));

    REQUIRE(f.until([&] { return f.find(id) != nullptr; }));
    CHECK(f.find(id)->name == "cmd 1");
    CHECK(f.find(id)->tabId == "t1");
}

TEST_CASE("한글을 넣고 받아도 깨지지 않는다 (AC6)") {
    TerminalsFixture f;
    const auto id = f.openCmd();

    REQUIRE(f.terminals.write(id, "echo 결과=한글 터미널\r"));
    CHECK(f.untilSeen("결과=한글 터미널"));

    REQUIRE(f.terminals.write(id, "echo 내용> 한글파일.txt\r"));
    CHECK(f.until([&] { return fs::exists(f.dir.path() / L"한글파일.txt"); }));
}

TEST_CASE("띄울 셸이 하나도 없으면 터미널을 띄우지 않는다 (AC27)") {
    va::test::TempDir dir;
    Terminals none({});
    CHECK_FALSE(none.open("t1", dir.path()));
    CHECK(none.list().empty());
}

TEST_CASE("PowerShell 7이 뜨지 않으면 명령 프롬프트로 뜬다 (AC3)") {
    va::test::TempDir dir;
    auto shells = va::data::findShells({"pwsh"});
    REQUIRE(shells.size() == 1);
    // 설치된 것으로 보이지만 실행되지 않는 PowerShell 7
    shells.insert(shells.begin(), {"pwsh", "PowerShell", dir.path() / "broken" / "pwsh.exe", L"-NoLogo"});

    Terminals terminals(shells);
    const auto view = terminals.open("t1", dir.path());
    REQUIRE(view);
    CHECK(view->shell == "cmd");
    CHECK(view->name == "cmd 1");
}

TEST_CASE("터미널 번호는 탭마다 1부터 매기고, 닫힌 번호는 다시 쓴다 (AC14)") {
    TerminalsFixture f;
    const auto first = f.terminals.open("t1", f.dir.path());
    const auto second = f.terminals.open("t1", f.dir.path());
    const auto other = f.terminals.open("t2", f.dir.path());
    REQUIRE((first && second && other));
    CHECK(first->name == "cmd 1");
    CHECK(second->name == "cmd 2");
    CHECK(other->name == "cmd 1");

    REQUIRE(f.terminals.close(first->id));
    REQUIRE(f.until([&] { return f.terminals.list().size() == 2; }));
    const auto again = f.terminals.open("t1", f.dir.path());
    REQUIRE(again);
    CHECK(again->name == "cmd 1");
}

TEST_CASE("exit로 셸이 끝나면 터미널이 목록에서 사라진다 (AC18)") {
    TerminalsFixture f;
    const auto id = f.openCmd();
    REQUIRE(f.terminals.write(id, "exit\r"));
    CHECK(f.until([&] { return f.terminals.list().empty(); }, 5s));
    CHECK_FALSE(f.terminals.write(id, "echo x\r"));
}

TEST_CASE("실행 중인 프로그램이 있는지 알아내고, 터미널을 닫으면 그 프로그램도 끝난다 (AC17, AC29)") {
    TerminalsFixture f;
    const auto id = f.openCmd();
    CHECK_FALSE(f.terminals.busy(id));
    CHECK_FALSE(f.terminals.anyBusy());

    REQUIRE(f.terminals.write(id, "ping -n 600 127.0.0.1\r"));
    REQUIRE(f.until([&] { return f.terminals.busy(id); }, 5s));
    CHECK(f.terminals.tabBusy("t1"));
    CHECK_FALSE(f.terminals.tabBusy("t2"));
    CHECK(f.terminals.anyBusy());
    // 목록에도 반영된다
    CHECK(f.until([&] { return f.find(id) != nullptr && f.find(id)->busy; }, 5s));

    const auto processes = f.terminals.processIds(id);  // 셸과 ping
    REQUIRE(processes.size() >= 2);

    REQUIRE(f.terminals.close(id));
    CHECK(f.until([&] { return f.terminals.list().empty(); }, 10s));
    CHECK_FALSE(f.terminals.anyBusy());
    CHECK(f.until([&] { return std::none_of(processes.begin(), processes.end(), running); }, 10s));
}

TEST_CASE("Ctrl+C를 보내면 실행 중인 프로그램이 멈추고 셸은 남는다 (AC10)") {
    TerminalsFixture f;
    const auto id = f.openCmd();
    REQUIRE(f.terminals.write(id, "ping -n 600 127.0.0.1\r"));
    REQUIRE(f.until([&] { return f.terminals.busy(id); }, 5s));
    // 프로그램이 막 뜬 순간(콘솔에 붙기 전)에 보낸 Ctrl+C는 전달되지 않는다. 첫 응답이 찍힌 뒤에 보낸다
    REQUIRE(f.untilSeen("TTL="));

    REQUIRE(f.terminals.write(id, "\x03"));
    CHECK(f.until([&] { return !f.terminals.busy(id); }, 5s));
    REQUIRE(f.terminals.write(id, "echo still-here\r"));
    CHECK(f.untilSeen("\nstill-here"));
}

TEST_CASE("터미널에서 에이전트를 실행하면 이름이 표시되고, 끝내면 사라진다 (AC21, AC22)") {
    TerminalsFixture f;
    const Path agent = f.dir.path() / "bin" / "claude.exe";
    fs::create_directories(agent.parent_path());
    fs::copy_file(VA_FAKE_AGENT_PATH, agent);
    const Path log = f.dir.path() / "keys.log";

    const auto id = f.openCmd();
    const auto idle = f.terminals.open("t1", f.dir.path());
    REQUIRE(idle);

    REQUIRE(f.terminals.write(id, "bin\\claude.exe keys.log\r"));
    REQUIRE(f.untilSeen("FAKE AGENT READY"));
    REQUIRE(f.until([&] { return f.find(id) != nullptr && f.find(id)->agent == "Claude Code"; }, 3s));
    CHECK(f.find(id)->busy);
    // 에이전트를 실행하지 않은 터미널에는 표시가 없다 (AC23)
    REQUIRE(f.find(idle->id) != nullptr);
    CHECK(f.find(idle->id)->agent.empty());

    // 화살표, Enter, Esc, Ctrl+C가 프로그램에 그대로 전달된다 (AC7)
    REQUIRE(f.terminals.write(id, "\x1b[A"));
    REQUIRE(f.untilSeen("last key: UP"));
    REQUIRE(f.terminals.write(id, "\r"));
    REQUIRE(f.untilSeen("last key: ENTER"));
    REQUIRE(f.terminals.write(id, "\x1b"));
    REQUIRE(f.untilSeen("last key: ESC"));
    REQUIRE(f.terminals.write(id, "\x03"));

    REQUIRE(f.until([&] { return f.find(id) != nullptr && f.find(id)->agent.empty(); }, 3s));
    CHECK_FALSE(f.find(id)->busy);
    CHECK(readFile(log) == "UP\nENTER\nESC\nCTRL+C\n");
}

TEST_CASE("PowerShell 7에서 실행한 에이전트도 이름이 표시되고, 실행 중인 프로그램으로 센다 (AC17, AC21)") {
    auto shells = va::data::findShells();
    if (shells.empty() || shells[0].id != "pwsh") {
        MESSAGE("PowerShell 7이 설치되어 있지 않아 건너뜀");
        return;
    }
    va::test::TempDir dir;
    fs::copy_file(VA_FAKE_AGENT_PATH, dir.path() / "claude.exe");
    // 넣은 명령이 사용자의 PowerShell 명령 기록에 남지 않도록, 셸이 뜨면서 바로 실행하게 한다
    shells[0].arguments = L"-NoLogo -NoProfile -Command .\\claude.exe";

    Terminals terminals({shells[0]});
    const auto view = terminals.open("t1", dir.path());
    REQUIRE(view);
    const auto shown = [&] {
        const auto list = terminals.list();
        return list.size() == 1 && list[0].agent == "Claude Code" && list[0].busy;
    };
    const auto deadline = std::chrono::steady_clock::now() + 15s;
    while (!shown() && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(100ms);
    CHECK(shown());
}

TEST_CASE("크기를 바꾸면 터미널 안의 프로그램이 새 크기를 안다 (AC8)") {
    TerminalsFixture f;
    const auto id = f.openCmd();
    REQUIRE(f.terminals.write(id, "\"" + std::string(VA_FAKE_AGENT_PATH) + "\"\r"));
    REQUIRE(f.untilSeen("size 120x30"));

    REQUIRE(f.terminals.resize(id, 90, 40));
    // 시험용 프로그램은 키를 받을 때마다 크기를 다시 적는다. 크기 변경이 전해지기 전에 키가 먼저 닿을 수 있어 될 때까지 누른다
    CHECK(f.until([&] {
        f.terminals.write(id, "r");
        return f.seen.find("size 90x40") != std::string::npos;
    }));
    REQUIRE(f.terminals.write(id, "q"));
}

TEST_CASE("많은 출력이 한꺼번에 나와도 빠짐없이 차례대로 받는다 (AC11)") {
    TerminalsFixture f;
    const auto id = f.openCmd();
    REQUIRE(f.terminals.write(id, "for /L %i in (1,1,20000) do @echo row-%i-end\r"));
    REQUIRE(f.untilSeen("row-20000-end", 60s));

    std::size_t at = 0;
    int missing = 0;
    for (int i = 1; i <= 20000; i += 997) {
        const auto found = f.seen.find("row-" + std::to_string(i) + "-end", at);
        if (found == std::string::npos) ++missing; else at = found;
    }
    CHECK(missing == 0);
}

TEST_CASE("화면이 받아 가지 않아도 출력이 끝없이 쌓이지 않고, 받아 가기 시작하면 이어진다 (AC11)") {
    TerminalsFixture f;
    const auto id = f.openCmd();
    REQUIRE(f.terminals.write(id, "for /L %i in (1,1,200000) do @echo padding-padding-padding-padding-%i\r"));
    std::this_thread::sleep_for(3s);  // 받아 가지 않는 동안
    // 다른 터미널은 그동안에도 띄우고 닫을 수 있다
    const auto other = f.terminals.open("t1", f.dir.path());
    REQUIRE(other);
    CHECK(f.terminals.close(other->id));
    CHECK(f.untilSeen("padding-200000", 120s));
}

TEST_CASE("새 기다림이 들어오면 앞의 기다림은 출력을 가져가지 않고 끝난다") {
    TerminalsFixture f;
    va::data::TerminalEvents first;
    std::thread waiter([&] { first = f.terminals.wait(f.terminals.wait(0, 0ms).version, 10s); });
    std::this_thread::sleep_for(200ms);
    const auto second = f.terminals.wait(0, 0ms);
    waiter.join();
    CHECK(first.superseded);
    CHECK_FALSE(second.superseded);
}

TEST_CASE("띄우자마자 닫아도 셸이 남지 않는다 (AC29)") {
    const va::test::TempDir dir;
    Terminals terminals(va::data::findShells({"pwsh"}));
    std::vector<unsigned long> shells;
    for (int i = 0; i < 5; ++i) {
        const auto view = terminals.open("t1", dir.path());
        REQUIRE(view);
        for (const auto pid : terminals.processIds(view->id)) shells.push_back(pid);
        // 셸이 콘솔에 붙을 틈도 주지 않고 닫는다
        REQUIRE(terminals.close(view->id));
    }
    REQUIRE(shells.size() == 5);

    const auto deadline = std::chrono::steady_clock::now() + 8s;
    while (std::any_of(shells.begin(), shells.end(), running) && std::chrono::steady_clock::now() < deadline) {
        std::this_thread::sleep_for(100ms);
    }
    CHECK(std::none_of(shells.begin(), shells.end(), running));
    CHECK(terminals.list().empty());
}

TEST_CASE("모두 닫으면 터미널에서 돌던 셸이 남지 않는다 (AC29)") {
    const va::test::TempDir dir;
    std::vector<unsigned long> shells;
    Terminals terminals(va::data::findShells({"pwsh"}));
    for (int i = 0; i < 3; ++i) {
        const auto view = terminals.open("t1", dir.path());
        REQUIRE(view);
        for (const auto pid : terminals.processIds(view->id)) shells.push_back(pid);
    }
    REQUIRE(shells.size() == 3);
    CHECK(std::all_of(shells.begin(), shells.end(), running));

    terminals.shutdown();
    CHECK(terminals.list().empty());
    // 뒷정리가 늦어져 기다리지 않고 끝낸 경우에도, 남은 셸은 Windows가 곧 끝낸다
    const auto deadline = std::chrono::steady_clock::now() + 8s;
    while (std::any_of(shells.begin(), shells.end(), running) && std::chrono::steady_clock::now() < deadline) {
        std::this_thread::sleep_for(100ms);
    }
    CHECK(std::none_of(shells.begin(), shells.end(), running));
    CHECK_FALSE(terminals.open("t1", dir.path()));
}
