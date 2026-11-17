// 화면 배치의 규칙: 하이어라키 사이드바의 너비와, 에이전트 칸·파일 칸이 나눠 갖는 높이의 비율.
// 파일 시스템, 창, 네트워크를 모른다.
#pragma once

#include <nlohmann/json.hpp>

namespace va::domain {

struct Layout {
    int sidebarWidth = 240;    // 사이드바 너비 (px)
    double agentShare = 0.5;   // 두 칸의 높이 가운데 에이전트 칸의 몫 (0~1)
};

inline constexpr int kNarrowestSidebar = 180;
inline constexpr int kWidestSidebar = 4000;  // 화면 크기에 따른 한계는 화면이 다시 건다
inline constexpr double kSmallestShare = 0.05;
inline constexpr double kLargestShare = 0.95;

// 한계를 벗어난 값을 한계 안으로 옮긴다. 수가 아닌 값(NaN)은 처음 값으로 바꾼다
Layout normalized(Layout layout);

nlohmann::json layoutToJson(const Layout& layout);

// {"sidebarWidth": 수, "agentShare": 수} 모양을 읽는다. 항목이 없거나 수가 아니면 그 항목은 처음 값
Layout layoutFromJson(const nlohmann::json& json);

}  // namespace va::domain
