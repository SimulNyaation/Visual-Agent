#include <doctest/doctest.h>

#include "domain/project_tabs.h"

using va::domain::ProjectTabs;

namespace {
const auto kAllExist = [](const std::filesystem::path&) { return true; };
}

TEST_CASE("폴더를 열면 탭이 생기고 그 탭이 선택된다 (AC2, AC3)") {
    ProjectTabs tabs;
    const auto first = tabs.open(L"C:\\work\\alpha");
    CHECK(tabs.tabs().size() == 1);
    CHECK(tabs.activeId() == first);

    const auto second = tabs.open(L"C:\\work\\beta");
    CHECK(tabs.tabs().size() == 2);
    CHECK(tabs.activeId() == second);

    const auto view = tabs.view(kAllExist);
    CHECK(view[0].name == "alpha");
    CHECK(view[1].name == "beta");
}

TEST_CASE("이미 열린 폴더를 다시 열면 새 탭 없이 기존 탭이 선택된다 (AC6)") {
    ProjectTabs tabs;
    const auto alpha = tabs.open(L"C:\\work\\alpha");
    tabs.open(L"C:\\work\\beta");

    SUBCASE("같은 경로") { CHECK(tabs.open(L"C:\\work\\alpha") == alpha); }
    SUBCASE("대소문자만 다른 경로") { CHECK(tabs.open(L"c:\\WORK\\Alpha") == alpha); }
    SUBCASE("끝에 \\가 붙은 경로") { CHECK(tabs.open(L"C:\\work\\alpha\\") == alpha); }
    SUBCASE("..을 거쳐 같은 폴더가 되는 경로") { CHECK(tabs.open(L"C:\\work\\beta\\..\\alpha") == alpha); }

    CHECK(tabs.tabs().size() == 2);
    CHECK(tabs.activeId() == alpha);
}

TEST_CASE("탭을 닫으면 옆 탭이 선택되고, 마지막 탭을 닫으면 비게 된다 (AC5)") {
    ProjectTabs tabs;
    const auto a = tabs.open(L"C:\\p\\a");
    const auto b = tabs.open(L"C:\\p\\b");
    const auto c = tabs.open(L"C:\\p\\c");

    SUBCASE("선택된 가운데 탭을 닫으면 오른쪽 탭이 선택된다") {
        tabs.select(b);
        CHECK(tabs.close(b));
        CHECK(tabs.activeId() == c);
    }
    SUBCASE("선택된 맨 오른쪽 탭을 닫으면 왼쪽 탭이 선택된다") {
        CHECK(tabs.close(c));
        CHECK(tabs.activeId() == b);
    }
    SUBCASE("선택되지 않은 탭을 닫으면 선택은 그대로다") {
        CHECK(tabs.close(a));
        CHECK(tabs.activeId() == c);
    }
    SUBCASE("모두 닫으면 탭도 선택도 없다") {
        tabs.close(a);
        tabs.close(b);
        tabs.close(c);
        CHECK(tabs.tabs().empty());
        CHECK(tabs.activeId().empty());
    }
    SUBCASE("없는 탭은 닫을 수 없다") { CHECK_FALSE(tabs.close("nope")); }
}

TEST_CASE("저장했다가 읽으면 탭 순서와 선택된 탭이 그대로다 (AC7)") {
    ProjectTabs tabs;
    const auto a = tabs.open(L"C:\\p\\가나다");
    tabs.open(L"C:\\p\\b");
    tabs.select(a);

    auto restored = ProjectTabs::fromJson(tabs.toJson());
    REQUIRE(restored.tabs().size() == 2);
    CHECK(restored.tabs()[0].path == std::filesystem::path(L"C:\\p\\가나다"));
    CHECK(restored.tabs()[1].path == std::filesystem::path(L"C:\\p\\b"));
    CHECK(restored.activeId() == a);

    SUBCASE("복원한 뒤 새로 여는 탭은 기존 탭과 id가 겹치지 않는다") {
        const auto fresh = restored.open(L"C:\\p\\c");
        CHECK(fresh != restored.tabs()[0].id);
        CHECK(fresh != restored.tabs()[1].id);
    }
}

TEST_CASE("깨진 저장 내용은 빈 탭 목록으로 읽는다") {
    CHECK(ProjectTabs::fromJson(nlohmann::json::parse("[]")).tabs().empty());
    CHECK(ProjectTabs::fromJson(nlohmann::json::parse(R"({"tabs": "x"})")).tabs().empty());
    const auto partial = ProjectTabs::fromJson(
        nlohmann::json::parse(R"({"tabs":[{"id":"t1","path":"C:/a"},{"id":5}],"activeId":"gone"})"));
    REQUIRE(partial.tabs().size() == 1);
    CHECK(partial.activeId() == "t1");
}

TEST_CASE("폴더가 없어진 탭은 missing으로 표시되고 다른 탭은 정상이다 (AC8)") {
    ProjectTabs tabs;
    tabs.open(L"C:\\p\\here");
    tabs.open(L"C:\\p\\gone");
    const auto view = tabs.view([](const std::filesystem::path& path) {
        return path.filename() != "gone";
    });
    CHECK_FALSE(view[0].missing);
    CHECK(view[1].missing);
}

TEST_CASE("이름이 같은 폴더는 상위 폴더 이름을 붙여 구분한다 (AS8)") {
    ProjectTabs tabs;
    tabs.open(L"C:\\client\\web");
    tabs.open(L"C:\\admin\\web");
    tabs.open(L"C:\\other\\docs");
    const auto view = tabs.view(kAllExist);
    CHECK(view[0].label == "web (client)");
    CHECK(view[1].label == "web (admin)");
    CHECK(view[2].label == "docs");

    SUBCASE("상위 폴더 이름까지 같으면 전체 경로를 표시한다") {
        ProjectTabs same;
        same.open(L"C:\\x\\site\\web");
        same.open(L"D:\\y\\site\\web");
        const auto labels = same.view(kAllExist);
        CHECK(labels[0].label == "C:\\x\\site\\web");
        CHECK(labels[1].label == "D:\\y\\site\\web");
    }
}
