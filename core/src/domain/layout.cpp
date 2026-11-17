#include "domain/layout.h"

#include <algorithm>
#include <cmath>

namespace va::domain {

Layout normalized(Layout layout) {
    layout.sidebarWidth = std::clamp(layout.sidebarWidth, kNarrowestSidebar, kWidestSidebar);
    if (std::isnan(layout.agentShare)) layout.agentShare = Layout{}.agentShare;
    layout.agentShare = std::clamp(layout.agentShare, kSmallestShare, kLargestShare);
    return layout;
}

nlohmann::json layoutToJson(const Layout& layout) {
    return {{"sidebarWidth", layout.sidebarWidth}, {"agentShare", layout.agentShare}};
}

Layout layoutFromJson(const nlohmann::json& json) {
    Layout layout;
    if (!json.is_object()) return layout;
    if (json.contains("sidebarWidth") && json["sidebarWidth"].is_number()) {
        // 터무니없이 큰 수가 들어 있어도 넘치지 않게 실수로 읽어 자른 뒤 정수로 바꾼다
        const double width = json["sidebarWidth"].get<double>();
        if (!std::isnan(width)) {
            layout.sidebarWidth = static_cast<int>(
                std::clamp(width, static_cast<double>(kNarrowestSidebar), static_cast<double>(kWidestSidebar)));
        }
    }
    if (json.contains("agentShare") && json["agentShare"].is_number()) {
        layout.agentShare = json["agentShare"].get<double>();
    }
    return normalized(layout);
}

}  // namespace va::domain
