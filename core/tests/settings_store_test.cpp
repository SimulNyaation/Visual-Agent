#include <doctest/doctest.h>

#include <fstream>

#include "data/settings_store.h"
#include "temp_dir.h"

using va::data::SettingsStore;
using va::domain::ProjectTabs;

TEST_CASE("저장한 탭을 새로 만든 저장소에서 그대로 읽는다 (AC7)") {
    const va::test::TempDir dir;
    ProjectTabs tabs;
    tabs.open(L"C:\\p\\one");
    const auto two = tabs.open(L"C:\\p\\two");

    REQUIRE(SettingsStore(dir.path() / "nested").save(tabs, {}));

    const auto loaded = SettingsStore(dir.path() / "nested").load();
    REQUIRE(loaded.tabs().size() == 2);
    CHECK(loaded.activeId() == two);
}

TEST_CASE("저장 파일이 없거나 깨져 있으면 빈 탭 목록으로 시작한다") {
    const va::test::TempDir dir;
    const SettingsStore store(dir.path());
    CHECK(store.load().tabs().empty());

    std::ofstream(store.file()) << "{ not json";
    CHECK(store.load().tabs().empty());
}

TEST_CASE("화면 배치를 탭과 함께 저장하고 다시 읽는다 (AC11)") {
    const va::test::TempDir dir;
    ProjectTabs tabs;
    tabs.open(L"C:\\p\\one");
    REQUIRE(SettingsStore(dir.path()).save(tabs, {333, 0.25}));

    const SettingsStore store(dir.path());
    CHECK(store.loadLayout().sidebarWidth == 333);
    CHECK(store.loadLayout().agentShare == doctest::Approx(0.25));
    CHECK(store.load().tabs().size() == 1);
}

TEST_CASE("배치 항목이 없는 예전 파일도 탭은 그대로 읽고, 배치는 처음 값이다 (AC12)") {
    const va::test::TempDir dir;
    const SettingsStore store(dir.path());
    std::filesystem::create_directories(dir.path());
    // SPEC-20261116-file-explorer 때의 형식. 이전 판이 적어 둔 기본 셸 항목이 남아 있는 경우도 포함
    std::ofstream(store.file())
        << R"({"version":1,"tabs":[{"id":"t1","path":"C:\\p\\one"}],"activeId":"t1","nextId":2,"defaultShell":"cmd"})";

    CHECK(store.load().tabs().size() == 1);
    CHECK(store.loadLayout().sidebarWidth == 240);
    CHECK(store.loadLayout().agentShare == doctest::Approx(0.5));
}

TEST_CASE("배치 값이 깨져 있거나 한계를 벗어나 있어도 탭은 읽고, 배치는 한계 안의 값이다 (AC12)") {
    const va::test::TempDir dir;
    const SettingsStore store(dir.path());
    std::filesystem::create_directories(dir.path());
    std::ofstream(store.file())
        << R"({"version":1,"tabs":[{"id":"t1","path":"C:\\p\\one"}],"activeId":"t1","nextId":2,"layout":{"sidebarWidth":5,"agentShare":"half"}})";
    CHECK(store.load().tabs().size() == 1);
    CHECK(store.loadLayout().sidebarWidth == 180);
    CHECK(store.loadLayout().agentShare == doctest::Approx(0.5));

    std::ofstream(store.file()) << R"({"version":1,"tabs":[],"layout":[1,2,3]})";
    CHECK(store.loadLayout().sidebarWidth == 240);
}
