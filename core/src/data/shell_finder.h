// 앱이 띄우는 셸(PowerShell 7, 명령 프롬프트)이 이 컴퓨터의 어디에 있는지 찾는다.
#pragma once

#include <filesystem>
#include <string>
#include <vector>

namespace va::data {

struct InstalledShell {
    std::string id;
    std::string label;  // 터미널 줄에 번호와 함께 표시할 이름
    std::filesystem::path program;
    std::wstring arguments;
};

// 설치된 것만, 띄워 볼 순서대로 돌려준다.
// hidden에 적힌 셸은 설치되어 있어도 없는 것으로 친다 (자동 테스트용)
std::vector<InstalledShell> findShells(const std::vector<std::string>& hidden = {});

}  // namespace va::data
