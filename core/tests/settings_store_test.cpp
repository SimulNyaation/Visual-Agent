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

    REQUIRE(SettingsStore(dir.path() / "nested").save(tabs));

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
