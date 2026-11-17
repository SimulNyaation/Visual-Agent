#include <doctest/doctest.h>

#include <limits>

#include "domain/layout.h"

using namespace va::domain;
using nlohmann::json;

TEST_CASE("처음 배치는 사이드바 240, 두 칸 반반이다 (AC10)") {
    const Layout layout;
    CHECK(layout.sidebarWidth == 240);
    CHECK(layout.agentShare == doctest::Approx(0.5));
}

TEST_CASE("한계를 벗어난 배치는 한계 안으로 옮긴다 (AC3, AC12)") {
    CHECK(normalized({10, 0.5}).sidebarWidth == 180);
    CHECK(normalized({-500, 0.5}).sidebarWidth == 180);
    CHECK(normalized({99999, 0.5}).sidebarWidth == 4000);
    CHECK(normalized({300, 0.5}).sidebarWidth == 300);
    CHECK(normalized({300, 0.0}).agentShare == doctest::Approx(0.05));
    CHECK(normalized({300, -3.0}).agentShare == doctest::Approx(0.05));
    CHECK(normalized({300, 7.0}).agentShare == doctest::Approx(0.95));
    CHECK(normalized({300, std::numeric_limits<double>::quiet_NaN()}).agentShare == doctest::Approx(0.5));
}

TEST_CASE("배치를 적었다가 그대로 읽는다 (AC11)") {
    const auto read = layoutFromJson(layoutToJson({312, 0.3}));
    CHECK(read.sidebarWidth == 312);
    CHECK(read.agentShare == doctest::Approx(0.3));
}

TEST_CASE("배치 값이 없거나 깨져 있으면 처음 값으로 읽는다 (AC12)") {
    CHECK(layoutFromJson(json::object()).sidebarWidth == 240);
    CHECK(layoutFromJson(json("text")).agentShare == doctest::Approx(0.5));
    CHECK(layoutFromJson(json{{"sidebarWidth", "wide"}, {"agentShare", nullptr}}).sidebarWidth == 240);
    CHECK(layoutFromJson(json{{"sidebarWidth", "wide"}, {"agentShare", nullptr}}).agentShare == doctest::Approx(0.5));
    // 한쪽만 온전하면 그쪽은 살린다
    CHECK(layoutFromJson(json{{"sidebarWidth", 400}}).sidebarWidth == 400);
    CHECK(layoutFromJson(json{{"agentShare", 0.7}}).agentShare == doctest::Approx(0.7));
    // 터무니없이 큰 수
    CHECK(layoutFromJson(json{{"sidebarWidth", 1e300}, {"agentShare", 1e300}}).sidebarWidth == 4000);
    CHECK(layoutFromJson(json{{"sidebarWidth", -1e300}, {"agentShare", -1e300}}).agentShare == doctest::Approx(0.05));
    CHECK(layoutFromJson(json{{"sidebarWidth", 250.7}}).sidebarWidth == 250);
}
