// 열려 있던 탭 같은 개인 설정을 파일로 저장하고 읽는다.
#pragma once

#include <filesystem>

#include "domain/layout.h"
#include "domain/project_tabs.h"

namespace va::data {

class SettingsStore {
public:
    explicit SettingsStore(std::filesystem::path directory);

    // 파일이 없거나 읽을 수 없으면 빈 탭 목록을 돌려준다
    domain::ProjectTabs load() const;

    // 화면 배치. 파일이 없거나, 예전 형식이라 배치 항목이 없거나, 값이 깨져 있으면 처음 값(한계를 벗어난 값은 한계 안으로)
    domain::Layout loadLayout() const;

    // 탭과 화면 배치를 한 파일에 쓴다. 쓰다가 중단돼도 기존 파일이 깨지지 않게 임시 파일에 쓴 뒤 바꿔치기한다
    bool save(const domain::ProjectTabs& tabs, const domain::Layout& layout) const;

    const std::filesystem::path& file() const { return file_; }

private:
    std::filesystem::path directory_;
    std::filesystem::path file_;
};

}  // namespace va::data
