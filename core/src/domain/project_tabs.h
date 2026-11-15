// 프로젝트 탭 목록의 규칙. 파일 시스템, 창, 네트워크를 모른다.
#pragma once

#include <filesystem>
#include <functional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace va::domain {

struct ProjectTab {
    std::string id;
    std::filesystem::path path;
};

// 화면에 보내는 탭 한 개의 모습
struct ProjectTabView {
    std::string id;
    std::string name;   // 폴더 이름
    std::string label;  // 탭에 표시할 이름. 같은 이름의 폴더가 있으면 상위 폴더 이름을 덧붙인다
    std::string path;
    bool missing = false;  // 폴더를 찾을 수 없음
};

std::string toUtf8(const std::filesystem::path& path);
std::filesystem::path fromUtf8(const std::string& text);

class ProjectTabs {
public:
    using ExistsFn = std::function<bool(const std::filesystem::path&)>;

    // 폴더를 탭으로 연다. 이미 열려 있으면 새 탭을 만들지 않고 그 탭을 선택한다.
    // 선택된 탭의 id를 돌려준다.
    std::string open(const std::filesystem::path& folder);

    // 탭을 닫는다. 선택된 탭을 닫으면 오른쪽 탭, 없으면 왼쪽 탭이 선택된다.
    bool close(const std::string& id);

    bool select(const std::string& id);

    const std::vector<ProjectTab>& tabs() const { return tabs_; }
    const std::string& activeId() const { return activeId_; }

    std::vector<ProjectTabView> view(const ExistsFn& exists) const;

    nlohmann::json toJson() const;
    static ProjectTabs fromJson(const nlohmann::json& json);

private:
    std::vector<ProjectTab> tabs_;
    std::string activeId_;
    unsigned nextId_ = 1;
};

}  // namespace va::domain
