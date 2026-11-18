// 터미널 요청을 실제 서버와 실제 셸(명령 프롬프트)로 확인한다.
#include <doctest/doctest.h>

#include <chrono>
#include <fstream>
#include <thread>

#include <httplib.h>
#include <nlohmann/json.hpp>

#include "data/recycle_bin.h"
#include "data/shell_finder.h"
#include "server/api_server.h"
#include "temp_dir.h"

using nlohmann::json;
using Path = std::filesystem::path;
namespace fs = std::filesystem;
using namespace std::chrono_literals;

namespace {

struct Reply {
    int status = 0;
    json body;
};

std::string decode(const std::string& text) {
    static const std::string alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    unsigned value = 0;
    int bits = 0;
    for (const char c : text) {
        const auto at = alphabet.find(c);
        if (at == std::string::npos) break;
        value = (value << 6) | static_cast<unsigned>(at);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<char>((value >> bits) & 0xFF));
        }
    }
    return out;
}

std::vector<va::data::InstalledShell> only(const std::string& id) {
    std::vector<va::data::InstalledShell> shells;
    for (const auto& shell : va::data::findShells()) {
        if (shell.id == id) shells.push_back(shell);
    }
    return shells;
}

struct TerminalRoutesFixture {
    va::test::TempDir dir;
    Path alpha = dir.path() / "projects" / "alpha";
    Path beta = dir.path() / "projects" / "beta";
    std::unique_ptr<va::server::ApiServer> server;
    std::string alphaId;
    int quits = 0;
    std::string seen;
    std::uint64_t version = 0;
    json terminals = json::array();
    unsigned quitRequests = 0;

    explicit TerminalRoutesFixture(std::vector<va::data::InstalledShell> shells = only("cmd")) {
        fs::create_directories(alpha);
        fs::create_directories(beta);
        fs::create_directories(dir.path() / "ui");
        std::ofstream(dir.path() / "ui" / "index.html") << "<!doctype html><title>ui</title>";
        start(std::move(shells));
        alphaId = openTab(alpha);
    }

    void start(std::vector<va::data::InstalledShell> shells) {
        server.reset();
        va::server::ApiServerOptions options;
        options.uiDirectory = dir.path() / "ui";
        options.token = "secret-token";
        options.pickFolder = [] { return std::optional<Path>(); };
        options.folderExists = [](const Path& folder) {
            std::error_code ec;
            return fs::is_directory(folder, ec);
        };
        options.trash = va::data::folderTrash(dir.path() / "trash");
        options.shells = std::move(shells);
        options.quit = [this] { ++quits; };
        server = std::make_unique<va::server::ApiServer>(
            std::move(options), va::data::SettingsStore(dir.path() / "settings"));
        REQUIRE(server->start());
    }

    httplib::Client client() const {
        httplib::Client http("127.0.0.1", server->port());
        http.set_default_headers({{"X-VA-Token", "secret-token"}});
        http.set_read_timeout(40s);
        return http;
    }

    Reply post(const std::string& path, const json& body = json::object()) const {
        auto http = client();
        const auto res = http.Post(path.c_str(), body.dump(), "application/json");
        REQUIRE(res);
        return {res->status, json::parse(res->body, nullptr, false)};
    }

    Reply get(const std::string& path) const {
        auto http = client();
        const auto res = http.Get(path.c_str());
        REQUIRE(res);
        return {res->status, json::parse(res->body, nullptr, false)};
    }

    Reply remove(const std::string& path) const {
        auto http = client();
        const auto res = http.Delete(path.c_str());
        REQUIRE(res);
        return {res->status, json::parse(res->body, nullptr, false)};
    }

    std::string openTab(const Path& folder) const {
        return post("/api/tabs", {{"path", va::domain::toUtf8(folder)}}).body["activeId"];
    }

    std::string openTerminal(const std::string& tab, const json& body = json::object()) {
        const auto reply = post("/api/tabs/" + tab + "/terminals", body);
        REQUIRE(reply.status == 200);
        return reply.body["terminal"]["id"];
    }

    void pump() {
        // 화면처럼 소식을 받아 간다. 붙잡히지 않도록 아는 것이 없는 척 물어본다
        const auto reply = post("/api/terminals/events", {{"version", 0}});
        REQUIRE(reply.status == 200);
        version = reply.body["version"];
        terminals = reply.body["terminals"];
        quitRequests = reply.body["quitRequests"];
        for (const auto& chunk : reply.body["output"]) seen += decode(chunk["data"]);
    }

    template <typename Check>
    bool until(Check check, std::chrono::seconds limit = 15s) {
        const auto deadline = std::chrono::steady_clock::now() + limit;
        while (std::chrono::steady_clock::now() < deadline) {
            if (check()) return true;
            pump();
            std::this_thread::sleep_for(50ms);
        }
        return check();
    }

    bool untilSeen(const std::string& text) {
        return until([&] { return seen.find(text) != std::string::npos; });
    }

    void type(const std::string& id, const std::string& text) {
        REQUIRE(post("/api/terminals/" + id + "/input", {{"data", text}}).status == 200);
    }
};

}  // namespace

TEST_CASE("터미널 요청도 열쇠가 없거나 다른 주소로 오면 거부된다 (AC30)") {
    TerminalRoutesFixture f;
    const auto id = f.openTerminal(f.alphaId);
    const std::vector<std::string> paths = {
        "/api/tabs/" + f.alphaId + "/terminals", "/api/terminals/" + id + "/input",
        "/api/terminals/" + id + "/resize",      "/api/terminals/" + id + "/close",
        "/api/terminals/events",                 "/api/app/quit",
    };

    for (const auto& path : paths) {
        CAPTURE(path);
        httplib::Client none("127.0.0.1", f.server->port());
        const auto missing = none.Post(path.c_str(), R"({"data":"echo hacked\r","force":true,"confirm":true})",
                                       "application/json");
        REQUIRE(missing);
        CHECK(missing->status == 401);

        httplib::Client wrong("127.0.0.1", f.server->port());
        wrong.set_default_headers({{"X-VA-Token", "guess"}});
        const auto guessed = wrong.Post(path.c_str(), "{}", "application/json");
        REQUIRE(guessed);
        CHECK(guessed->status == 401);

        // 다른 사이트가 사용자의 브라우저를 시켜 보낸 요청 (Host가 다르다)
        httplib::Client other("127.0.0.1", f.server->port());
        other.set_default_headers({{"X-VA-Token", "secret-token"}, {"Host", "evil.example"}});
        const auto foreign = other.Post(path.c_str(), "{}", "application/json");
        REQUIRE(foreign);
        CHECK(foreign->status == 403);
    }
    CHECK(f.quits == 0);
    // 거부된 요청으로는 터미널이 닫히지도, 글자가 들어가지도 않았다
    f.pump();
    CHECK(f.terminals.size() == 1);
    CHECK(f.seen.find("hacked") == std::string::npos);
}

TEST_CASE("터미널을 띄우고 글자를 보내면 소식으로 출력이 돌아온다 (AC1, AC5)") {
    TerminalRoutesFixture f;
    const auto id = f.openTerminal(f.alphaId);
    REQUIRE(f.untilSeen(">"));
    f.type(id, "echo here=%CD%\r");
    CHECK(f.untilSeen("here=" + va::domain::toUtf8(fs::canonical(f.alpha))));

    REQUIRE(f.terminals.size() == 1);
    CHECK(f.terminals[0]["id"] == id);
    CHECK(f.terminals[0]["tabId"] == f.alphaId);
    CHECK(f.terminals[0]["name"] == "cmd 1");
    CHECK(f.terminals[0]["agent"] == "");
}

TEST_CASE("자동으로 띄우는 터미널은 탭마다 한 번뿐이다 (AC1, AC2, AS6)") {
    TerminalRoutesFixture f;
    const auto first = f.post("/api/tabs/" + f.alphaId + "/terminals", {{"automatic", true}});
    REQUIRE(first.status == 200);
    CHECK(first.body["terminal"].is_object());

    // 같은 탭을 다시 보거나, 그 터미널을 닫은 뒤에도 다시 자동으로 뜨지 않는다
    const auto second = f.post("/api/tabs/" + f.alphaId + "/terminals", {{"automatic", true}});
    REQUIRE(second.status == 200);
    CHECK(second.body["terminal"].is_null());
    f.pump();
    CHECK(f.terminals.size() == 1);

    // 직접 띄우는 것은 언제나 된다
    CHECK(f.post("/api/tabs/" + f.alphaId + "/terminals").body["terminal"]["name"] == "cmd 2");

    // 앱을 다시 켜면 탭마다 다시 한 번 뜬다
    f.start(only("cmd"));
    const auto restarted = f.post("/api/tabs/" + f.alphaId + "/terminals", {{"automatic", true}});
    CHECK(restarted.body["terminal"]["name"] == "cmd 1");
}

TEST_CASE("폴더를 찾을 수 없는 탭이나 없는 탭에는 터미널이 뜨지 않는다 (AC4)") {
    TerminalRoutesFixture f;
    const auto betaId = f.openTab(f.beta);
    fs::remove_all(f.beta);
    const auto missing = f.post("/api/tabs/" + betaId + "/terminals", {{"automatic", true}});
    CHECK(missing.status == 404);
    CHECK(missing.body["error"] == "folder_not_found");
    CHECK(f.post("/api/tabs/nope/terminals").status == 404);
    f.pump();
    CHECK(f.terminals.empty());
}

TEST_CASE("PowerShell 7이 없는 컴퓨터에서는 명령 프롬프트로 뜬다 (AC3)") {
    TerminalRoutesFixture f(only("cmd"));
    const auto reply = f.post("/api/tabs/" + f.alphaId + "/terminals", {{"automatic", true}});
    REQUIRE(reply.status == 200);
    CHECK(reply.body["terminal"]["shell"] == "cmd");
    CHECK(reply.body["terminal"]["name"] == "cmd 1");
}

TEST_CASE("셸을 골라 달라는 요청은 받지 않는다. 언제나 정해진 순서로 뜬다 (AC24)") {
    TerminalRoutesFixture f(only("cmd"));
    const auto reply = f.post("/api/tabs/" + f.alphaId + "/terminals", {{"shell", "powershell"}});
    REQUIRE(reply.status == 200);
    CHECK(reply.body["terminal"]["shell"] == "cmd");
    CHECK(f.get("/api/shells").status == 404);
    CHECK(f.post("/api/shells/default", {{"id", "cmd"}}).status == 404);
}

TEST_CASE("설치된 셸이 하나도 없으면 이유와 함께 거절한다 (AC27)") {
    TerminalRoutesFixture f({});
    const auto reply = f.post("/api/tabs/" + f.alphaId + "/terminals", {{"automatic", true}});
    CHECK(reply.status == 409);
    CHECK(reply.body["error"] == "no_shell");
}

TEST_CASE("실행 중인 프로그램이 있는 터미널은 묻지 않고는 닫히지 않는다 (AC17)") {
    TerminalRoutesFixture f;
    const auto id = f.openTerminal(f.alphaId);
    REQUIRE(f.untilSeen(">"));

    f.type(id, "ping -n 600 127.0.0.1\r");
    REQUIRE(f.untilSeen("127.0.0.1"));
    REQUIRE(f.until([&] { return f.terminals.size() == 1 && f.terminals[0]["busy"] == true; }));

    const auto refused = f.post("/api/terminals/" + id + "/close");
    CHECK(refused.status == 409);
    CHECK(refused.body["error"] == "busy");
    f.pump();
    CHECK(f.terminals.size() == 1);

    CHECK(f.post("/api/terminals/" + id + "/close", {{"force", true}}).status == 200);
    CHECK(f.until([&] { return f.terminals.empty(); }));
    CHECK(f.post("/api/terminals/" + id + "/close").status == 404);
}

TEST_CASE("명령을 기다리기만 하는 터미널은 묻지 않고 닫힌다 (AS14)") {
    TerminalRoutesFixture f;
    const auto id = f.openTerminal(f.alphaId);
    REQUIRE(f.untilSeen(">"));
    CHECK(f.post("/api/terminals/" + id + "/close").status == 200);
    CHECK(f.until([&] { return f.terminals.empty(); }));
}

TEST_CASE("실행 중인 프로그램이 있는 탭은 묻지 않고는 닫히지 않고, 닫으면 터미널도 닫힌다 (AC28, AC29)") {
    TerminalRoutesFixture f;
    const auto betaId = f.openTab(f.beta);
    const auto id = f.openTerminal(f.alphaId);
    f.openTerminal(betaId);
    REQUIRE(f.untilSeen(">"));
    f.type(id, "ping -n 600 127.0.0.1\r");
    REQUIRE(f.untilSeen("127.0.0.1"));

    const auto refused = f.remove("/api/tabs/" + f.alphaId);
    CHECK(refused.status == 409);
    CHECK(refused.body["error"] == "busy");
    CHECK(f.get("/api/state").body["tabs"].size() == 2);

    CHECK(f.remove("/api/tabs/" + f.alphaId + "?force=1").status == 200);
    CHECK(f.get("/api/state").body["tabs"].size() == 1);
    // 닫은 탭의 터미널만 닫히고 다른 탭의 터미널은 남는다
    CHECK(f.until([&] { return f.terminals.size() == 1 && f.terminals[0]["tabId"] == betaId; }));

    // 실행 중인 프로그램이 없는 탭은 묻지 않고 닫힌다
    CHECK(f.remove("/api/tabs/" + betaId).status == 200);
    CHECK(f.until([&] { return f.terminals.empty(); }));
}

TEST_CASE("앱을 닫으려 할 때 실행 중인 프로그램이 없으면 바로 닫아도 된다 (AC28)") {
    TerminalRoutesFixture f;
    CHECK(f.server->requestClose());
    f.openTerminal(f.alphaId);
    REQUIRE(f.untilSeen(">"));
    CHECK(f.server->requestClose());
}

TEST_CASE("앱을 닫으려 할 때 실행 중인 프로그램이 있으면 화면에 확인을 요청한다 (AC28)") {
    TerminalRoutesFixture f;
    const auto id = f.openTerminal(f.alphaId);
    REQUIRE(f.untilSeen(">"));
    f.type(id, "ping -n 600 127.0.0.1\r");
    REQUIRE(f.untilSeen("127.0.0.1"));
    REQUIRE(f.quitRequests == 0);

    CHECK_FALSE(f.server->requestClose());
    f.pump();
    CHECK(f.quitRequests == 1);

    // 취소하면 아무 일도 없다
    CHECK(f.post("/api/app/quit", {{"confirm", false}}).status == 200);
    CHECK(f.quits == 0);
    // 확인하면 앱 창을 닫으라고 알린다
    CHECK(f.post("/api/app/quit", {{"confirm", true}}).status == 200);
    CHECK(f.quits == 1);
}

TEST_CASE("화면이 소식을 받아 가지 않고 있으면(화면이 멈춤) 확인 없이 닫을 수 있다") {
    TerminalRoutesFixture f;
    const auto id = f.openTerminal(f.alphaId);
    REQUIRE(f.untilSeen(">"));
    f.type(id, "ping -n 600 127.0.0.1\r");
    REQUIRE(f.untilSeen("127.0.0.1"));

    std::this_thread::sleep_for(6s);  // 화면이 한동안 소식을 받아 가지 않음
    CHECK(f.server->requestClose());
}

TEST_CASE("서버를 멈추면 소식을 기다리던 요청이 끝나고 터미널이 모두 닫힌다 (AC29)") {
    TerminalRoutesFixture f;
    f.openTerminal(f.alphaId);
    REQUIRE(f.untilSeen(">"));
    f.pump();

    std::thread waiter([&] {
        auto http = f.client();
        http.Post("/api/terminals/events", json{{"version", f.version}}.dump(), "application/json");
    });
    std::this_thread::sleep_for(300ms);
    const auto started = std::chrono::steady_clock::now();
    f.server->stop();
    waiter.join();
    CHECK(std::chrono::steady_clock::now() - started < 8s);
}

TEST_CASE("훅 소식은 터미널에만 알려 준 값으로만 받는다. 화면의 값으로도, 훅의 값으로 다른 요청도 안 된다 (SPEC-20261118-sub-agents AC9)") {
    TerminalRoutesFixture f;
    const auto id = f.openTerminal(f.alphaId);
    const std::string body = R"({"hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"Explore"})";
    const auto send = [&](const httplib::Headers& headers) {
        httplib::Client http("127.0.0.1", f.server->port());
        const auto res = http.Post("/api/hooks/claude", headers, body, "application/json");
        REQUIRE(res);
        return res->status;
    };

    CHECK(send({{"X-VA-Terminal", id}}) == 401);
    CHECK(send({{"X-VA-Terminal", id}, {"X-VA-Hook-Token", "guess"}}) == 401);
    // 화면이 쓰는 값은 훅 소식에 통하지 않는다
    CHECK(send({{"X-VA-Terminal", id}, {"X-VA-Token", "secret-token"}}) == 401);
    CHECK(send({{"X-VA-Terminal", id}, {"X-VA-Hook-Token", "secret-token"}}) == 401);
    f.pump();
    CHECK(f.terminals[0]["subAgents"].empty());
}

TEST_CASE("터미널에서 실행한 에이전트의 훅이 va-hook으로 보낸 소식이 그 터미널에 붙는다 (SPEC-20261118-sub-agents AC1, AC9)") {
    TerminalRoutesFixture f;
    fs::copy_file(VA_FAKE_AGENT_PATH, f.alpha / "claude.exe");
    fs::copy_file(VA_HOOK_PATH, f.alpha / "va-hook.exe");
    std::ofstream(f.alpha / "hook1.json") << R"({"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"subagent_type":"Explore","description":"로그인 코드 찾기"}})";
    std::ofstream(f.alpha / "hook2.json") << R"({"hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"Explore"})";
    std::ofstream(f.alpha / "hook3.json") << R"({"hook_event_name":"SubagentStop","agent_id":"a1","agent_type":"Explore"})";

    const auto id = f.openTerminal(f.alphaId);
    REQUIRE(f.untilSeen(">"));
    f.type(id, ".\\claude.exe\r");
    const bool ready = f.untilSeen("FAKE AGENT READY");
    INFO(f.seen);
    REQUIRE(ready);
    const auto other = f.openTerminal(f.alphaId);
    const auto find = [&](const std::string& wanted) {
        for (const auto& terminal : f.terminals) {
            if (terminal["id"] == wanted) return terminal;
        }
        return json(json::object());
    };
    REQUIRE(f.until([&] { return find(id).value("agent", "") == "Claude Code"; }));

    f.type(id, "1");
    f.type(id, "2");
    REQUIRE(f.until([&] { return find(id)["subAgents"].size() == 1; }));
    const json sub = find(id)["subAgents"][0];
    CHECK(sub["id"] == "a1");
    CHECK(sub["type"] == "Explore");
    CHECK(sub["description"] == "로그인 코드 찾기");
    CHECK(find(id)["working"] == true);
    // 다른 터미널에는 붙지 않는다
    CHECK(find(other)["subAgents"].empty());

    f.type(id, "3");
    CHECK(f.until([&] { return find(id)["subAgents"].empty(); }));
    f.type(id, "q");
}
