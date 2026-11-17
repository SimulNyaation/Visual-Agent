#include <doctest/doctest.h>

#include <fstream>

#include <httplib.h>
#include <nlohmann/json.hpp>

#include "data/recycle_bin.h"
#include "server/api_server.h"
#include "temp_dir.h"

using nlohmann::json;

namespace {

struct Fixture {
    va::test::TempDir dir;
    std::filesystem::path projectA = dir.path() / "projects" / "alpha";
    std::filesystem::path projectB = dir.path() / "projects" / "beta";
    std::optional<std::filesystem::path> nextPick;
    std::unique_ptr<va::server::ApiServer> server;

    Fixture() {
        std::filesystem::create_directories(projectA);
        std::filesystem::create_directories(projectB);
        std::filesystem::create_directories(dir.path() / "ui");
        std::ofstream(dir.path() / "ui" / "index.html") << "<!doctype html><title>ui</title>";
        boot();
    }

    // 앱을 껐다 켠 것처럼 서버를 새로 만든다
    void boot() {
        server.reset();
        va::server::ApiServerOptions options;
        options.uiDirectory = dir.path() / "ui";
        options.token = "secret-token";
        options.pickFolder = [this] { return nextPick; };
        options.folderExists = [](const std::filesystem::path& folder) {
            std::error_code ec;
            return std::filesystem::is_directory(folder, ec);
        };
        options.trash = va::data::folderTrash(dir.path() / "trash");
        server = std::make_unique<va::server::ApiServer>(
            std::move(options), va::data::SettingsStore(dir.path() / "settings"));
        REQUIRE(server->start());
    }

    httplib::Client client(const char* token = "secret-token") const {
        httplib::Client http("127.0.0.1", server->port());
        if (token) http.set_default_headers({{"X-VA-Token", token}});
        return http;
    }

    json openPath(const std::filesystem::path& folder) const {
        auto http = client();
        const auto res = http.Post("/api/tabs", json{{"path", va::domain::toUtf8(folder)}}.dump(),
                                   "application/json");
        REQUIRE(res);
        REQUIRE(res->status == 200);
        return json::parse(res->body);
    }

    json state() const {
        auto http = client();
        const auto res = http.Get("/api/state");
        REQUIRE(res);
        REQUIRE(res->status == 200);
        return json::parse(res->body);
    }
};

}  // namespace

TEST_CASE_FIXTURE(Fixture, "접속 값이 없거나 틀리면 프로젝트 내용을 주지 않는다") {
    auto none = client(nullptr);
    auto res = none.Get("/api/state");
    REQUIRE(res);
    CHECK(res->status == 401);

    auto wrong = client("wrong");
    res = wrong.Get("/api/state");
    REQUIRE(res);
    CHECK(res->status == 401);
    CHECK(res->body.find("tabs") == std::string::npos);
}

TEST_CASE_FIXTURE(Fixture, "다른 주소 이름으로 들어온 요청은 거부한다") {
    auto http = client();
    const auto res = http.Get("/api/state", httplib::Headers{{"Host", "evil.example:80"}});
    REQUIRE(res);
    CHECK(res->status == 403);
}

TEST_CASE_FIXTURE(Fixture, "화면 파일은 접속 값 없이 받을 수 있다") {
    auto http = client(nullptr);
    const auto res = http.Get("/index.html");
    REQUIRE(res);
    CHECK(res->status == 200);
}

TEST_CASE_FIXTURE(Fixture, "폴더 선택 창에서 고른 폴더가 탭으로 열린다 (AC2)") {
    CHECK(state()["tabs"].empty());

    nextPick = projectA;
    auto http = client();
    const auto res = http.Post("/api/tabs", "{}", "application/json");
    REQUIRE(res);
    REQUIRE(res->status == 200);
    const auto body = json::parse(res->body);
    REQUIRE(body["tabs"].size() == 1);
    CHECK(body["tabs"][0]["name"] == "alpha");
    CHECK(body["activeId"] == body["tabs"][0]["id"]);
}

TEST_CASE_FIXTURE(Fixture, "폴더 선택을 취소하면 탭이 그대로다") {
    openPath(projectA);
    nextPick = std::nullopt;
    auto http = client();
    const auto res = http.Post("/api/tabs", "{}", "application/json");
    REQUIRE(res);
    const auto body = json::parse(res->body);
    CHECK(body["cancelled"] == true);
    CHECK(body["tabs"].size() == 1);
}

TEST_CASE_FIXTURE(Fixture, "탭 추가·선택·닫기 (AC3, AC4, AC5, AC6)") {
    const auto first = openPath(projectA);
    const auto second = openPath(projectB);
    const std::string idA = first["tabs"][0]["id"];
    const std::string idB = second["tabs"][1]["id"];
    CHECK(second["activeId"] == idB);

    auto http = client();

    SUBCASE("탭을 선택하면 선택된 탭이 바뀐다") {
        const auto res = http.Post(("/api/tabs/" + idA + "/select").c_str());
        REQUIRE(res);
        CHECK(json::parse(res->body)["activeId"] == idA);
    }
    SUBCASE("이미 열린 폴더를 다시 열면 탭 수는 그대로이고 그 탭이 선택된다") {
        const auto again = openPath(projectA);
        CHECK(again["tabs"].size() == 2);
        CHECK(again["activeId"] == idA);
    }
    SUBCASE("탭을 닫으면 사라지고 옆 탭이 선택된다") {
        const auto res = http.Delete(("/api/tabs/" + idB).c_str());
        REQUIRE(res);
        const auto body = json::parse(res->body);
        CHECK(body["tabs"].size() == 1);
        CHECK(body["activeId"] == idA);
    }
    SUBCASE("없는 탭을 고르거나 닫으면 404") {
        CHECK(http.Post("/api/tabs/zzz/select")->status == 404);
        CHECK(http.Delete("/api/tabs/zzz")->status == 404);
    }
    SUBCASE("없는 폴더는 열 수 없다") {
        const auto res = http.Post(
            "/api/tabs", json{{"path", va::domain::toUtf8(dir.path() / "nope")}}.dump(),
            "application/json");
        REQUIRE(res);
        CHECK(res->status == 400);
        CHECK(state()["tabs"].size() == 2);
    }
}

TEST_CASE_FIXTURE(Fixture, "다시 실행하면 탭 순서와 선택이 그대로다 (AC7)") {
    const auto first = openPath(projectA);
    openPath(projectB);
    const std::string idA = first["tabs"][0]["id"];
    auto http = client();
    REQUIRE(http.Post(("/api/tabs/" + idA + "/select").c_str()));

    boot();

    const auto restored = state();
    REQUIRE(restored["tabs"].size() == 2);
    CHECK(restored["tabs"][0]["name"] == "alpha");
    CHECK(restored["tabs"][1]["name"] == "beta");
    CHECK(restored["activeId"] == idA);
}

TEST_CASE_FIXTURE(Fixture, "다시 실행했을 때 없어진 폴더의 탭은 missing이고 닫을 수 있다 (AC8)") {
    openPath(projectA);
    const auto opened = openPath(projectB);
    const std::string idB = opened["tabs"][1]["id"];

    boot();
    std::filesystem::remove_all(projectB);

    const auto restored = state();
    CHECK(restored["tabs"][0]["missing"] == false);
    CHECK(restored["tabs"][1]["missing"] == true);

    auto http = client();
    const auto res = http.Delete(("/api/tabs/" + idB).c_str());
    REQUIRE(res);
    CHECK(json::parse(res->body)["tabs"].size() == 1);
}

TEST_CASE_FIXTURE(Fixture, "화면 배치를 기억하고, 다시 실행해도 그대로다 (AC11)") {
    auto http = client();
    auto res = http.Get("/api/layout");
    REQUIRE(res);
    CHECK(json::parse(res->body) == json{{"sidebarWidth", 240}, {"agentShare", 0.5}});

    openPath(projectA);
    res = http.Post("/api/layout", json{{"sidebarWidth", 320}, {"agentShare", 0.25}}.dump(), "application/json");
    REQUIRE(res);
    CHECK(res->status == 200);

    boot();
    auto again = client();
    res = again.Get("/api/layout");
    REQUIRE(res);
    CHECK(json::parse(res->body) == json{{"sidebarWidth", 320}, {"agentShare", 0.25}});
    // 배치를 저장해도 탭은 그대로다
    CHECK(state()["tabs"].size() == 1);

    // 탭을 바꿔 저장해도 배치는 그대로다
    openPath(projectB);
    boot();
    auto third = client();
    res = third.Get("/api/layout");
    REQUIRE(res);
    CHECK(json::parse(res->body)["sidebarWidth"] == 320);
    CHECK(state()["tabs"].size() == 2);
}

TEST_CASE_FIXTURE(Fixture, "한계를 벗어난 배치는 한계 안으로 옮겨 기억하고, 수가 아닌 값은 받지 않는다 (AC3, AC12)") {
    auto http = client();
    auto res = http.Post("/api/layout", json{{"sidebarWidth", 3}, {"agentShare", 9}}.dump(), "application/json");
    REQUIRE(res);
    CHECK(json::parse(res->body) == json{{"sidebarWidth", 180}, {"agentShare", 0.95}});

    for (const char* body : {R"({"sidebarWidth":"wide","agentShare":0.5})", R"({"sidebarWidth":300})", "[]", "not json"}) {
        CAPTURE(body);
        res = http.Post("/api/layout", body, "application/json");
        REQUIRE(res);
        CHECK(res->status == 400);
    }
    res = http.Get("/api/layout");
    REQUIRE(res);
    CHECK(json::parse(res->body)["sidebarWidth"] == 180);
}

TEST_CASE_FIXTURE(Fixture, "열쇠가 없으면 화면 배치를 읽거나 바꿀 수 없다") {
    auto none = client(nullptr);
    auto res = none.Get("/api/layout");
    REQUIRE(res);
    CHECK(res->status == 401);
    res = none.Post("/api/layout", json{{"sidebarWidth", 500}, {"agentShare", 0.9}}.dump(), "application/json");
    REQUIRE(res);
    CHECK(res->status == 401);

    auto http = client();
    res = http.Get("/api/layout");
    REQUIRE(res);
    CHECK(json::parse(res->body)["sidebarWidth"] == 240);
}
