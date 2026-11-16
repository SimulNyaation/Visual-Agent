// 지운 것을 보내는 곳.
#pragma once

#include <filesystem>

#include "data/project_files.h"

namespace va::data {

// Windows 휴지통으로 보낸다. 휴지통에 넣을 수 없는 것(네트워크 드라이브 등)은 지우지 않고 "no_trash"를 돌려준다
TrashFn recycleBinTrash();

// 휴지통 대신 정해 준 폴더로 옮긴다. 자동 테스트가 실제 휴지통을 채우지 않게 하기 위함이다
TrashFn folderTrash(std::filesystem::path folder);

}  // namespace va::data
