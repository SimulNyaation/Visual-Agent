#include "domain/project_tabs.h"

#include <algorithm>
#include <cwctype>
#include <map>

namespace va::domain {

namespace {

std::filesystem::path normalize(const std::filesystem::path& folder) {
    auto normal = folder.lexically_normal();
    // "C:\a\b\" 와 "C:\a\b" 를 같은 폴더로 본다
    if (!normal.has_filename() && normal.has_parent_path() && normal != normal.root_path()) {
        normal = normal.parent_path();
    }
    return normal;
}

// Windows는 폴더 이름의 대소문자를 구분하지 않는다
std::wstring compareKey(const std::filesystem::path& path) {
    std::wstring key = path.generic_wstring();
    std::transform(key.begin(), key.end(), key.begin(),
                   [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
    return key;
}

std::wstring lower(std::wstring text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
    return text;
}

std::filesystem::path displayName(const std::filesystem::path& path) {
    return path.has_filename() ? path.filename() : path;
}

}  // namespace

std::string toUtf8(const std::filesystem::path& path) {
    const auto u8 = path.u8string();
    return std::string(u8.begin(), u8.end());
}

std::filesystem::path fromUtf8(const std::string& text) {
    return std::filesystem::path(std::u8string(text.begin(), text.end()));
}

std::string ProjectTabs::open(const std::filesystem::path& folder) {
    const auto normal = normalize(folder);
    const auto key = compareKey(normal);
    for (const auto& tab : tabs_) {
        if (compareKey(tab.path) == key) {
            activeId_ = tab.id;
            return tab.id;
        }
    }
    ProjectTab tab{"t" + std::to_string(nextId_++), normal};
    tabs_.push_back(tab);
    activeId_ = tab.id;
    return tab.id;
}

bool ProjectTabs::close(const std::string& id) {
    const auto it = std::find_if(tabs_.begin(), tabs_.end(),
                                 [&](const ProjectTab& tab) { return tab.id == id; });
    if (it == tabs_.end()) return false;

    const bool wasActive = (activeId_ == id);
    const auto next = tabs_.erase(it);
    if (wasActive) {
        if (tabs_.empty()) {
            activeId_.clear();
        } else if (next != tabs_.end()) {
            activeId_ = next->id;
        } else {
            activeId_ = tabs_.back().id;
        }
    }
    return true;
}

bool ProjectTabs::select(const std::string& id) {
    const bool found = std::any_of(tabs_.begin(), tabs_.end(),
                                   [&](const ProjectTab& tab) { return tab.id == id; });
    if (found) activeId_ = id;
    return found;
}

std::vector<ProjectTabView> ProjectTabs::view(const ExistsFn& exists) const {
    std::map<std::wstring, int> nameCount;
    for (const auto& tab : tabs_) nameCount[lower(displayName(tab.path).wstring())]++;

    // 이름과 상위 폴더 이름까지 같은 경우를 가려내기 위한 두 번째 집계
    std::map<std::wstring, int> labelCount;
    std::vector<std::filesystem::path> labels;
    for (const auto& tab : tabs_) {
        auto name = displayName(tab.path);
        std::filesystem::path label = name;
        if (nameCount[lower(name.wstring())] > 1 && tab.path.has_parent_path()) {
            const auto parent = displayName(tab.path.parent_path());
            label = std::filesystem::path(name.wstring() + L" (" + parent.wstring() + L")");
        }
        labelCount[lower(label.wstring())]++;
        labels.push_back(label);
    }

    std::vector<ProjectTabView> views;
    for (std::size_t i = 0; i < tabs_.size(); ++i) {
        const auto& tab = tabs_[i];
        ProjectTabView item;
        item.id = tab.id;
        item.name = toUtf8(displayName(tab.path));
        item.path = toUtf8(tab.path);
        item.label = labelCount[lower(labels[i].wstring())] > 1 ? item.path : toUtf8(labels[i]);
        item.missing = !exists(tab.path);
        views.push_back(std::move(item));
    }
    return views;
}

nlohmann::json ProjectTabs::toJson() const {
    nlohmann::json tabs = nlohmann::json::array();
    for (const auto& tab : tabs_) {
        tabs.push_back({{"id", tab.id}, {"path", toUtf8(tab.path)}});
    }
    return {{"version", 1}, {"tabs", tabs}, {"activeId", activeId_}, {"nextId", nextId_}};
}

ProjectTabs ProjectTabs::fromJson(const nlohmann::json& json) {
    ProjectTabs result;
    if (!json.is_object() || !json.contains("tabs") || !json["tabs"].is_array()) return result;

    for (const auto& item : json["tabs"]) {
        if (!item.is_object() || !item.contains("id") || !item.contains("path")) continue;
        if (!item["id"].is_string() || !item["path"].is_string()) continue;
        result.tabs_.push_back({item["id"].get<std::string>(),
                                fromUtf8(item["path"].get<std::string>())});
    }

    unsigned highest = 0;
    for (const auto& tab : result.tabs_) {
        if (tab.id.size() > 1 && tab.id[0] == 't') {
            try {
                highest = std::max(highest, static_cast<unsigned>(std::stoul(tab.id.substr(1))));
            } catch (const std::exception&) {
                // 숫자가 아닌 id는 다음 번호 계산에서 제외한다
            }
        }
    }
    const unsigned stored = json.value("nextId", 1u);
    result.nextId_ = std::max(stored, highest + 1);

    const std::string active = json.value("activeId", std::string());
    if (!result.select(active) && !result.tabs_.empty()) {
        result.activeId_ = result.tabs_.front().id;
    }
    return result;
}

}  // namespace va::domain
