#include <doctest/doctest.h>

#include <chrono>
#include <fstream>
#include <future>
#include <sstream>
#include <thread>

#include <httplib.h>
#include <nlohmann/json.hpp>

#include "data/recycle_bin.h"
#include "server/api_server.h"
#include "temp_dir.h"

using nlohmann::json;
using Path = std::filesystem::path;
namespace fs = std::filesystem;
using namespace std::chrono_literals;

namespace {

void write(const Path& path, const std::string& content) {
    fs::create_directories(path.parent_path());
    std::ofstream(path, std::ios::binary) << content;
}

std::string read(const Path& path) {
    std::ifstream file(path, std::ios::binary);
    std::stringstream content;
    content << file.rdbuf();
    return content.str();
}

struct Reply {
    int status = 0;
    json body;
};

struct FilesFixture {
    va::test::TempDir dir;
    Path alpha = dir.path() / "projects" / "alpha";
    Path beta = dir.path() / "projects" / "beta";
    Path outside = dir.path() / "outside";
    std::unique_ptr<va::server::ApiServer> server;
    std::string alphaId;
    std::string betaId;

    FilesFixture() {
        write(alpha / "readme.md", "readme");
        write(alpha / "notes.txt", "notes");
        write(alpha / "src" / "main.cpp", "main");
        write(alpha / "docs" / "guide.md", "guide");
        write(beta / "b.txt", "b");
        write(outside / "secret.txt", "secret");
        write(dir.path() / "ui" / "index.html", "<!doctype html><title>ui</title>");

        va::server::ApiServerOptions options;
        options.uiDirectory = dir.path() / "ui";
        options.token = "secret-token";
        options.pickFolder = [] { return std::optional<Path>(); };
        options.folderExists = [](const Path& folder) {
            std::error_code ec;
            return fs::is_directory(folder, ec);
        };
        options.trash = va::data::folderTrash(dir.path() / "trash");
        server = std::make_unique<va::server::ApiServer>(
            std::move(options), va::data::SettingsStore(dir.path() / "settings"));
        REQUIRE(server->start());

        alphaId = open(alpha);
        betaId = open(beta);
    }

    httplib::Client client() const {
        httplib::Client http("127.0.0.1", server->port());
        http.set_default_headers({{"X-VA-Token", "secret-token"}});
        http.set_read_timeout(30s);
        return http;
    }

    std::string open(const Path& folder) const {
        auto http = client();
        const auto res = http.Post("/api/tabs", json{{"path", va::domain::toUtf8(folder)}}.dump(),
                                   "application/json");
        REQUIRE(res);
        const auto body = json::parse(res->body);
        return body["activeId"].get<std::string>();
    }

    Reply post(const std::string& tab, const std::string& action, const json& body) const {
        auto http = client();
        const auto res = http.Post(("/api/tabs/" + tab + "/files/" + action).c_str(), body.dump(),
                                   "application/json");
        REQUIRE(res);
        return {res->status, json::parse(res->body, nullptr, false)};
    }

    std::vector<std::string> names(const std::string& tab, const std::string& folder) const {
        const auto reply = post(tab, "list", {{"dirs", {folder}}});
        REQUIRE(reply.status == 200);
        std::vector<std::string> result;
        for (const auto& entry : reply.body["dirs"][0]["entries"]) result.push_back(entry["name"]);
        return result;
    }

    std::string stamp(const std::string& tab, const std::string& folder) const {
        return post(tab, "list", {{"dirs", {folder}}}).body["dirs"][0]["stamp"];
    }
};

}  // namespace

TEST_CASE_FIXTURE(FilesFixture, "폴더 여러 개의 내용을 한 번에 읽는다 (AC3, AC4)") {
    const auto reply = post(alphaId, "list", {{"dirs", {"", "src", "gone"}}});
    REQUIRE(reply.status == 200);
    const auto& dirs = reply.body["dirs"];
    REQUIRE(dirs.size() == 3);
    CHECK(dirs[0]["path"] == "");
    CHECK(dirs[0]["entries"][0] == json{{"name", "docs"}, {"kind", "folder"}});
    CHECK(dirs[0]["entries"][2] == json{{"name", "notes.txt"}, {"kind", "file"}});
    CHECK(dirs[1]["entries"][0]["name"] == "main.cpp");
    CHECK(dirs[2]["missing"] == true);
}

TEST_CASE_FIXTURE(FilesFixture, "접속 값이 없으면 파일 내용을 주지 않는다") {
    httplib::Client http("127.0.0.1", server->port());
    const auto res = http.Post(("/api/tabs/" + alphaId + "/files/list").c_str(),
                               json{{"dirs", {""}}}.dump(), "application/json");
    REQUIRE(res);
    CHECK(res->status == 401);
    CHECK(res->body.find("readme") == std::string::npos);
}

TEST_CASE_FIXTURE(FilesFixture, "없는 탭이나 폴더가 없어진 탭의 요청은 404 (AC9)") {
    CHECK(post("zzz", "list", {{"dirs", {""}}}).status == 404);
    fs::remove_all(beta);
    const auto reply = post(betaId, "list", {{"dirs", {""}}});
    CHECK(reply.status == 404);
    CHECK(reply.body["error"] == "folder_not_found");
}

TEST_CASE_FIXTURE(FilesFixture, "프로젝트 폴더 밖을 가리키는 요청은 모두 거부되고 밖의 파일은 그대로다 (AC27)") {
    const std::string absolute = va::domain::toUtf8(outside / "secret.txt");
    for (const std::string unsafe : {std::string("../outside/secret.txt"), std::string("src/../../outside"),
                                     absolute, std::string("C:/Windows"), std::string("..\\outside"),
                                     std::string("/outside"), std::string(".git/config")}) {
        CAPTURE(unsafe);
        CHECK(post(alphaId, "list", {{"dirs", {unsafe}}}).status == 400);
        CHECK(post(alphaId, "changes", {{"dirs", {{{"path", unsafe}, {"stamp", ""}}}}}).status == 400);
        CHECK(post(alphaId, "move", {{"items", {unsafe}}, {"to", "docs"}}).status == 400);
        CHECK(post(alphaId, "move", {{"items", {"readme.md"}}, {"to", unsafe}}).status == 400);
        CHECK(post(alphaId, "copy", {{"items", {unsafe}}, {"to", "docs"}}).status == 400);
        CHECK(post(alphaId, "copy", {{"items", {"readme.md"}}, {"to", unsafe}}).status == 400);
        CHECK(post(alphaId, "rename", {{"path", unsafe}, {"name", "x"}}).status == 400);
        CHECK(post(alphaId, "create", {{"parent", unsafe}, {"name", "x"}, {"kind", "file"}}).status == 400);
        CHECK(post(alphaId, "trash", {{"items", {unsafe}}}).status == 400);
    }
    // 이름에 경로를 넣어 밖으로 내보내는 것도 안 된다
    CHECK(post(alphaId, "rename", {{"path", "readme.md"}, {"name", "..\\..\\outside\\x.md"}}).status == 400);
    CHECK(post(alphaId, "create", {{"parent", ""}, {"name", "../x.txt"}, {"kind", "file"}}).status == 400);

    CHECK(read(outside / "secret.txt") == "secret");
    CHECK(read(alpha / "readme.md") == "readme");
    CHECK(names(alphaId, "docs") == std::vector<std::string>{"guide.md"});
    std::error_code ec;
    CHECK(std::distance(fs::directory_iterator(outside, ec), fs::directory_iterator()) == 1);
}

TEST_CASE_FIXTURE(FilesFixture, "화면이 아는 내용과 이미 다르면 바로 새 내용을 준다 (AC6)") {
    const auto started = std::chrono::steady_clock::now();
    const auto reply = post(alphaId, "changes", {{"dirs", {{{"path", ""}, {"stamp", "old"}}}}});
    CHECK(reply.status == 200);
    REQUIRE(reply.body["dirs"].size() == 1);
    CHECK(reply.body["dirs"][0]["path"] == "");
    CHECK(std::chrono::steady_clock::now() - started < 2s);
}

TEST_CASE_FIXTURE(FilesFixture, "밖에서 파일이 생기거나 없어지면 3초 안에 알린다 (AC6)") {
    const json known = {{"dirs",
                         {{{"path", ""}, {"stamp", stamp(alphaId, "")}},
                          {{"path", "src"}, {"stamp", stamp(alphaId, "src")}}}}};

    SUBCASE("펼쳐진 하위 폴더에 파일이 생김") {
        auto pending = std::async(std::launch::async, [&] { return post(alphaId, "changes", known); });
        std::this_thread::sleep_for(300ms);
        const auto changedAt = std::chrono::steady_clock::now();
        write(alpha / "src" / "added.cpp", "");

        REQUIRE(pending.wait_for(3s) == std::future_status::ready);
        const auto reply = pending.get();
        CHECK(std::chrono::steady_clock::now() - changedAt < 3s);
        REQUIRE(reply.body["dirs"].size() == 1);
        CHECK(reply.body["dirs"][0]["path"] == "src");
        CHECK(reply.body["dirs"][0]["entries"][0]["name"] == "added.cpp");
    }
    SUBCASE("펼쳐진 폴더가 통째로 없어짐") {
        auto pending = std::async(std::launch::async, [&] { return post(alphaId, "changes", known); });
        std::this_thread::sleep_for(300ms);
        fs::remove_all(alpha / "src");

        REQUIRE(pending.wait_for(3s) == std::future_status::ready);
        const auto reply = pending.get();
        bool sawMissing = false;
        for (const auto& changed : reply.body["dirs"]) {
            if (changed["path"] == "src" && changed["missing"] == true) sawMissing = true;
        }
        // 폴더가 지워지는 도중에 응답했을 수 있으므로, 한 번 더 물어 확인한다
        if (!sawMissing) {
            const auto again = post(alphaId, "changes", {{"dirs", {{{"path", "src"}, {"stamp", "x"}}}}});
            sawMissing = again.body["dirs"][0]["missing"] == true;
        }
        CHECK(sawMissing);
    }
}

TEST_CASE_FIXTURE(FilesFixture, "새로 기다리는 요청이 오면 앞의 기다림은 끝난다") {
    const json known = {{"dirs", {{{"path", ""}, {"stamp", stamp(alphaId, "")}}}}};
    auto first = std::async(std::launch::async, [&] { return post(alphaId, "changes", known); });
    std::this_thread::sleep_for(300ms);
    auto second = std::async(std::launch::async, [&] { return post(alphaId, "changes", known); });

    REQUIRE(first.wait_for(3s) == std::future_status::ready);
    CHECK(first.get().body["dirs"].empty());

    server->stop();
    REQUIRE(second.wait_for(3s) == std::future_status::ready);
}

TEST_CASE_FIXTURE(FilesFixture, "옮기기·이름 바꾸기·새로 만들기·붙여넣기를 차례로 되돌린다 (AC23, AC24)") {
    CHECK(post(alphaId, "move", {{"items", {"readme.md", "notes.txt"}}, {"to", "docs"}}).status == 200);
    CHECK(post(alphaId, "rename", {{"path", "src/main.cpp"}, {"name", "app.cpp"}}).status == 200);
    CHECK(post(alphaId, "create", {{"parent", "src"}, {"name", "new.ts"}, {"kind", "file"}}).status == 200);
    const auto pasted = post(alphaId, "copy", {{"items", {"src"}}, {"to", ""}});
    CHECK(pasted.status == 200);
    CHECK(pasted.body["changes"][0]["to"] == "src - 복사본");

    auto undone = post(alphaId, "undo", json::object());
    CHECK(undone.body["undone"]["kind"] == "copy");
    CHECK_FALSE(fs::exists(alpha / L"src - 복사본"));

    undone = post(alphaId, "undo", json::object());
    CHECK(undone.body["undone"]["kind"] == "create");
    CHECK(undone.body["undone"]["items"][0]["to"] == "src/new.ts");

    undone = post(alphaId, "undo", json::object());
    CHECK(undone.body["undone"]["kind"] == "rename");

    undone = post(alphaId, "undo", json::object());
    CHECK(undone.body["undone"]["kind"] == "move");
    CHECK(undone.body["undone"]["items"].size() == 2);

    CHECK(names(alphaId, "") == std::vector<std::string>{"docs", "src", "notes.txt", "readme.md"});
    CHECK(names(alphaId, "src") == std::vector<std::string>{"main.cpp"});
    CHECK(names(alphaId, "docs") == std::vector<std::string>{"guide.md"});
    CHECK(read(alpha / "readme.md") == "readme");

    const auto nothing = post(alphaId, "undo", json::object());
    CHECK(nothing.status == 409);
    CHECK(nothing.body["error"] == "nothing_to_undo");
}

TEST_CASE_FIXTURE(FilesFixture, "지우기는 되돌리기 기록에 올라가지 않고, 그 전 작업이 되돌려진다 (AS1)") {
    CHECK(post(alphaId, "rename", {{"path", "notes.txt"}, {"name", "memo.txt"}}).status == 200);
    CHECK(post(alphaId, "trash", {{"items", {"readme.md"}}}).status == 200);
    CHECK_FALSE(fs::exists(alpha / "readme.md"));

    const auto undone = post(alphaId, "undo", json::object());
    CHECK(undone.body["undone"]["kind"] == "rename");
    CHECK(fs::exists(alpha / "notes.txt"));
    CHECK_FALSE(fs::exists(alpha / "readme.md"));
}

TEST_CASE_FIXTURE(FilesFixture, "되돌릴 수 없게 된 작업은 이유를 알리고 건너뛴다 (AC25)") {
    CHECK(post(alphaId, "rename", {{"path", "notes.txt"}, {"name", "memo.txt"}}).status == 200);
    CHECK(post(alphaId, "move", {{"items", {"readme.md"}}, {"to", "docs"}}).status == 200);
    write(alpha / "readme.md", "newer");

    const auto blocked = post(alphaId, "undo", json::object());
    CHECK(blocked.status == 409);
    CHECK(blocked.body["error"] == "undo_name_taken");
    CHECK(read(alpha / "readme.md") == "newer");
    CHECK(read(alpha / "docs" / "readme.md") == "readme");

    const auto next = post(alphaId, "undo", json::object());
    CHECK(next.body["undone"]["kind"] == "rename");
}

TEST_CASE_FIXTURE(FilesFixture, "되돌리기 기록은 프로젝트 탭마다 따로다 (AS4)") {
    CHECK(post(alphaId, "rename", {{"path", "notes.txt"}, {"name", "memo.txt"}}).status == 200);
    CHECK(post(betaId, "undo", json::object()).body["error"] == "nothing_to_undo");
    CHECK(fs::exists(alpha / "memo.txt"));
    CHECK(post(alphaId, "undo", json::object()).status == 200);
}

TEST_CASE_FIXTURE(FilesFixture, "실패한 작업은 이유를 코드로 알린다 (AC15, AC16, AC19)") {
    write(alpha / "docs" / "readme.md", "other");
    CHECK(post(alphaId, "move", {{"items", {"readme.md"}}, {"to", "docs"}}).body["error"] == "name_taken");
    CHECK(post(alphaId, "move", {{"items", {"src"}}, {"to", "src"}}).body["error"] == "into_itself");
    CHECK(post(alphaId, "rename", {{"path", "readme.md"}, {"name", "a*b"}}).body["error"] == "invalid_name");
    CHECK(post(alphaId, "rename", {{"path", "readme.md"}, {"name", "notes.txt"}}).body["error"] == "name_taken");
    CHECK(post(alphaId, "move", {{"items", {"ghost.txt"}}, {"to", "docs"}}).status == 404);
    // 실패한 작업은 기록에 남지 않는다
    CHECK(post(alphaId, "undo", json::object()).body["error"] == "nothing_to_undo");
}
